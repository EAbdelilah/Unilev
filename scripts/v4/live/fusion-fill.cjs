/**
 * 1inch Fusion / Limit-Order-Protocol live fill (Base 8453).
 *
 *   node scripts/v4/live/fusion-fill.cjs plan        # read-only: size + sign + eth_call
 *   node scripts/v4/live/fusion-fill.cjs broadcast   # real signed txs
 *
 * Set BASE_RPC_URL=http://127.0.0.1:8545 to dry-run the whole flow on an anvil
 * fork of Base first.
 *
 * What this proves, on chain:
 *   - the maker EOA signs a REAL 1inch LOP v4 order whose maker-signed extension
 *     names EswapOneInchFusionSettlement as the post-interaction target;
 *   - the settler (as `operator`) calls its own fill(), which forwards to the live
 *     canonical LOP `fillOrderArgs`, so the canonical LOP verifies the signature,
 *     moves USDC maker -> settler and WETH settler -> maker, then fires the
 *     postInteraction callback;
 *   - fill() only returns after the callback proved itself (`pendingFills`),
 *     so a live receipt with status 1 is proof the gate fired.
 *
 * SIGNATURE CONVENTION (probed against the live LOP, see fusion-probe.cjs):
 * the maker signs the RAW digest returned by LOP.hashOrder(order), not EIP-712
 * typed data. Raw signing reaches the transfer stage (revert
 * TransferFromMakerToTakerFailed when the allowance is missing); both EIP-712
 * encodings revert BadSignature().
 *
 * SIZING CAVEAT: the deployed settler carries ONE scalar `maxFillAmount`
 * (5e9) that is applied to the USDC making leg AND the 18-decimal WETH taking
 * leg, so the WETH out is capped at 5 gwei. At the live ETH/USD price that is
 * ~11 USDC-units of notional. The cap is a deployment misconfiguration (see
 * MAINNET_PROOF.md §11); this script therefore sizes the fill at the cap
 * instead of inventing a bigger order, and reports the exact numbers.
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const LOP = '0x111111125421cA6dc452d289314280a0f8842A65';
const FUSION = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';
const CHAINLINK_ETH_USD = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const ORDER_FIELDS = [
  'uint256 salt',
  'uint256 maker',
  'uint256 receiver',
  'uint256 makerAsset',
  'uint256 takerAsset',
  'uint256 makingAmount',
  'uint256 takingAmount',
  'uint256 makerTraits',
];

const LOP_ABI = [
  `function hashOrder((${ORDER_FIELDS.join(',')})) view returns (bytes32)`,
];

// MakerTraits (upstream layout): bit 255 = no partial fills, bit 251 =
// post-interaction call, bit 249 = has extension, low 80 bits = allowed sender
// (0 = anyone may fill).
const MAKER_TRAITS = (1n << 255n) | (1n << 251n) | (1n << 249n);

// Canonical LOP event: OrderFilled(bytes32 indexed orderHash, uint256 remainingMakingAmount).
const LOP_ORDER_FILLED_TOPIC = ethers.id('OrderFilled(bytes32,uint256)');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), file), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

const gwei = (v) => BigInt(Math.round(Number(v) * 1e9));
const FEE = {
  maxFeePerGas: gwei(process.env.MAX_FEE_GWEI || '0.02'),
  maxPriorityFeePerGas: gwei(process.env.PRIORITY_FEE_GWEI || '0.001'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The public Base RPC is load-balanced: a read issued right after a mined tx can
// still hit a lagging backend. Poll until the expected state is visible.
async function waitFor(label, read, ok, tries = 30) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (ok(last)) return last;
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${label} (last=${last})`);
}

// 1inch v4 extension: 32-byte length table (8 x uint32 lanes, MSB first) then
// field data. Only postInteractionTargetAndData is populated: 20-byte target.
const extensionFor = (target) => ethers.concat([ethers.toBeHex(BigInt(20) << 224n, 32), target]);

const vsOf = (sig) => {
  let vs = BigInt(sig.s);
  if (sig.yParity) vs |= 1n << 255n;
  return ethers.toBeHex(vs, 32);
};

async function main() {
  const mode = process.argv[2] || 'plan';
  const broadcast = mode === 'broadcast';
  const env = loadEnv();
  const provider = new ethers.JsonRpcProvider(RPC);
  const solver = new ethers.Wallet(env.SOLVER_PRIVATE_KEY, provider);
  const maker = new ethers.Wallet(env.TINY_TRADER_PK, provider);

  const fusion = new ethers.Contract(FUSION, abiOf('out/EswapOneInchFusionSettlement.sol/EswapOneInchFusionSettlement.json'), provider);
  const lop = new ethers.Contract(LOP, LOP_ABI, provider);
  const usdc = new ethers.Contract(USDC, ERC20_ABI, provider);
  const weth = new ethers.Contract(WETH, ERC20_ABI, provider);
  const feed = new ethers.Contract(CHAINLINK_ETH_USD, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'], provider);

  const blk = await provider.getBlock('latest');
  const results = {
    mode,
    rpc: RPC,
    chainId: CHAIN_ID,
    startedAt: new Date().toISOString(),
    startBlock: blk.number,
    venue: '1inch Fusion / Limit Order Protocol v4',
    settler: FUSION,
    lop: LOP,
    steps: [],
  };
  console.log(`mode ${mode}  rpc ${RPC}  block ${blk.number}`);

  // ── deployed settler wiring ───────────────────────────────────────────
  const [settlerLop, makerAsset, takerAsset, maxFill, operator, owner] = await Promise.all([
    fusion.lop(),
    fusion.makerAsset(),
    fusion.takerAsset(),
    fusion.maxFillAmount(),
    fusion.operator(),
    fusion.owner(),
  ]);
  const wiring = { settlerLop, makerAsset, takerAsset, maxFill: maxFill.toString(), operator, owner };
  console.log('settler wiring', JSON.stringify(wiring, null, 0));
  if (settlerLop.toLowerCase() !== LOP.toLowerCase()) throw new Error('settler LOP mismatch');
  if (makerAsset.toLowerCase() !== USDC.toLowerCase()) throw new Error('settler makerAsset is not USDC');
  if (takerAsset.toLowerCase() !== WETH.toLowerCase()) throw new Error('settler takerAsset is not WETH');
  if (operator.toLowerCase() !== solver.address.toLowerCase()) throw new Error(`operator ${operator} != solver ${solver.address}`);
  if ((await provider.getCode(FUSION)) === '0x') throw new Error('no code at settler');

  // ── sizing: cap-bounded, market-priced ────────────────────────────────
  const [, ethAnswer] = await feed.latestRoundData();
  const p8 = BigInt(ethAnswer); // ETH/USD, 8 decimals
  const makerUsdc = await usdc.balanceOf(maker.address);
  const solverWeth = await weth.balanceOf(solver.address);

  // WETH out is bounded by maxFillAmount (wei) because fill() checks
  // `takingAmount > maxFillAmount`. Stay 4% under the cap for rounding slack.
  const takingAmount = (maxFill * 96n) / 100n;
  // Fair value at the live Chainlink ETH/USD price: making(6dp) = taking(wei)*p8/1e20
  const makingAmount = (takingAmount * p8) / 10n ** 20n;
  if (makingAmount === 0n) throw new Error('cap leaves no room for a non-zero USDC leg');
  if (makingAmount > makerUsdc) throw new Error(`maker USDC ${makerUsdc} < makingAmount ${makingAmount}`);
  if (takingAmount > solverWeth) throw new Error(`solver WETH ${solverWeth} < takingAmount ${takingAmount}`);
  if (makingAmount > maxFill) throw new Error('making leg exceeds maxFillAmount');

  console.log(`ETH/USD ${Number(p8) / 1e8}  maker USDC ${makerUsdc} units  solver WETH ${solverWeth} wei`);
  console.log(`sized making ${makingAmount} USDC-units  taking ${takingAmount} wei WETH  (cap ${maxFill})`);
  results.sizing = {
    ethUsd8: p8.toString(),
    makingAmount: makingAmount.toString(),
    takingAmount: takingAmount.toString(),
    maxFillAmount: maxFill.toString(),
    makerUsdcBalance: makerUsdc.toString(),
    note: 'WETH leg is capped by the settler maxFillAmount (5e9 wei = 5 gwei); the USDC leg is the fair value of that WETH at the live Chainlink price.',
  };

  // ── order + signature ─────────────────────────────────────────────────
  const extension = extensionFor(FUSION);
  const order = {
    salt: BigInt(ethers.keccak256(extension)),
    maker: BigInt(maker.address),
    receiver: BigInt(maker.address),
    makerAsset: BigInt(USDC),
    takerAsset: BigInt(WETH),
    makingAmount,
    takingAmount,
    makerTraits: MAKER_TRAITS,
  };
  const orderHash = await lop.hashOrder(order);
  const sig = maker.signingKey.sign(orderHash);
  const vs = vsOf(sig);
  // making-amount mode (bit 255), extension length in bits 224..247, low 200
  // bits = WORST taking amount the taker accepts. In making-amount mode the LOP
  // reverts TakingAmountTooHigh() when takingAmount > threshold, so this is a
  // ceiling, not a floor: it must be >= the order's own ratio.
  const takerTraits = (1n << 255n) | (BigInt(ethers.dataLength(extension)) << 224n) | takingAmount;

  console.log('orderHash ', orderHash);
  console.log('extension ', extension, `(${ethers.dataLength(extension)} bytes)`);
  console.log('takerTraits', '0x' + takerTraits.toString(16));
  console.log('signer    ', ethers.recoverAddress(orderHash, { r: sig.r, s: sig.s, yParity: sig.yParity }));
  results.order = Object.fromEntries(Object.entries(order).map(([k, v]) => [k, v.toString()]));
  results.orderHash = orderHash;
  results.signature = { r: sig.r, vs };
  results.takerTraits = takerTraits.toString();
  results.extension = extension;

  // ── pre-flight eth_call (real LOP, no state change) ───────────────────
  const fillTx = () => fusion.connect(solver).fill.populateTransaction(order, sig.r, vs, makingAmount, takerTraits, extension, '0x', maker.address);
  const probe = async (label) => {
    try {
      const data = (await fillTx()).data;
      await provider.call({ from: solver.address, to: FUSION, data });
      console.log(`  eth_call OK (${label})`);
      return null;
    } catch (e) {
      const msg = e.shortMessage || e.message;
      const code = e.data && e.data !== '0x' ? e.data.slice(0, 10) : null;
      console.log(`  eth_call revert (${label}): ${msg}${code ? ` [${code}]` : ''}`);
      return { label, error: msg, selector: code };
    }
  };

  console.log('\n[1/4] preflight eth_call');
  const pre = await probe('before approvals');
  results.preflightBeforeSetup = pre;

  if (!broadcast) {
    console.log('\nplan only. re-run with `broadcast` to send real txs.');
    fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
    fs.writeFileSync('scripts/v4/live/proofs/fusion-plan.json', JSON.stringify(results, null, 2));
    console.log('wrote scripts/v4/live/proofs/fusion-plan.json');
    return;
  }

  // ── maker approval: USDC -> LOP (one time) ────────────────────────────
  const need = makingAmount;
  const allowance = await usdc.allowance(maker.address, LOP);
  if (allowance < need) {
    console.log(`\n[2/4] maker approves USDC -> LOP (allowance ${allowance})`);
    const tx = await usdc.connect(maker).approve(LOP, ethers.MaxUint256, { gasLimit: 100_000, ...FEE });
    const rc = await tx.wait();
    await waitFor('maker allowance', () => usdc.allowance(maker.address, LOP), (v) => v >= need);
    console.log(`  tx ${tx.hash} status ${rc.status} gas ${rc.gasUsed} block ${rc.blockNumber}`);
    results.steps.push({ step: 'maker-approve', tx: tx.hash, url: `https://basescan.org/tx/${tx.hash}`, status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(), spender: LOP, token: USDC, before: allowance.toString() });
  } else {
    console.log(`\n[2/4] maker already approved USDC -> LOP (${allowance})`);
  }

  // ── settler WETH inventory (it is the taker and must deliver WETH) ────
  let settlerWeth = await weth.balanceOf(FUSION);
  if (settlerWeth < takingAmount) {
    const needWeth = takingAmount + (takingAmount / 100n) - settlerWeth; // +1% buffer
    console.log(`\n[3/4] funding settler WETH inventory: ${needWeth} wei from solver`);
    const tx = await weth.connect(solver).transfer(FUSION, needWeth, { gasLimit: 60_000, ...FEE });
    const rc = await tx.wait();
    settlerWeth = await waitFor('settler WETH', () => weth.balanceOf(FUSION), (v) => v >= takingAmount);
    console.log(`  tx ${tx.hash} status ${rc.status} gas ${rc.gasUsed} block ${rc.blockNumber} settlerWeth ${settlerWeth}`);
    results.steps.push({ step: 'settler-inventory', tx: tx.hash, url: `https://basescan.org/tx/${tx.hash}`, status: rc.status, block: rc.blockNumber, gasUsed: rc.gasUsed.toString(), amount: needWeth.toString(), settlerWethAfter: settlerWeth.toString() });
  } else {
    console.log(`\n[3/4] settler already holds ${settlerWeth} wei WETH`);
  }

  const post = await probe('after approvals');
  if (post) throw new Error(`preflight still reverting: ${post.error} [${post.selector}]`);
  results.preflightAfterSetup = null;

  // ── the fill itself ───────────────────────────────────────────────────
  const before = {
    makerUsdc: (await usdc.balanceOf(maker.address)).toString(),
    makerWeth: (await weth.balanceOf(maker.address)).toString(),
    settlerUsdc: (await usdc.balanceOf(FUSION)).toString(),
    settlerWeth: (await weth.balanceOf(FUSION)).toString(),
    solverWeth: (await weth.balanceOf(solver.address)).toString(),
  };
  console.log('\n[4/4] EswapOneInchFusionSettlement.fill  (operator = solver)');
  const tx = await fusion.connect(solver).fill(order, sig.r, vs, makingAmount, takerTraits, extension, '0x', maker.address, { gasLimit: 600_000, ...FEE });
  const rc = await tx.wait();
  console.log(`  tx ${tx.hash} status ${rc.status} gas ${rc.gasUsed} block ${rc.blockNumber}`);
  if (rc.status !== 1) throw new Error('fill reverted');

  // ── verification (poll: the public RPC can serve stale state) ─────────
  const after = {
    makerUsdc: (await waitFor('maker USDC', () => usdc.balanceOf(maker.address), (v) => v.toString() === (BigInt(before.makerUsdc) - makingAmount).toString())).toString(),
    makerWeth: (await waitFor('maker WETH', () => weth.balanceOf(maker.address), (v) => v.toString() === (BigInt(before.makerWeth) + takingAmount).toString())).toString(),
    settlerUsdc: (await waitFor('settler USDC', () => usdc.balanceOf(FUSION), (v) => v.toString() === (BigInt(before.settlerUsdc) + makingAmount).toString())).toString(),
    settlerWeth: (await weth.balanceOf(FUSION)).toString(),
  };
  const pending = await waitFor('pendingFills.fulfilled', () => fusion.pendingFills(orderHash), (v) => v[2] === true);
  // Decode from the receipt itself: the public Base RPC rejects some eth_getLogs
  // queries ("could not coalesce error"), and the receipt already holds every log.
  const iface = fusion.interface;
  const settlerLogs = rc.logs
    .filter((l) => l.address.toLowerCase() === FUSION.toLowerCase())
    .map((l) => ({ logIndex: l.index, parsed: iface.parseLog({ topics: l.topics, data: l.data }) }))
    .filter((l) => l.parsed && l.parsed.name === 'OrderFilled');
  const lopLogs = rc.logs
    .filter((l) => l.address.toLowerCase() === LOP.toLowerCase() && l.topics[0] === LOP_ORDER_FILLED_TOPIC)
    .map((l) => {
      if (l.topics.length > 1) {
        return { logIndex: l.index, orderHash: l.topics[1], remaining: BigInt(l.data) };
      }
      return { logIndex: l.index, orderHash: l.data.slice(0, 66), remaining: BigInt('0x' + l.data.slice(66)) };
    });

  // The settler emits OrderFilled twice on purpose: once when fill() returns and
  // once inside the postInteraction callback. Both must agree.
  const eventLogs = settlerLogs.map((l) => ({
    logIndex: l.logIndex,
    orderHash: l.parsed.args[0],
    recipient: l.parsed.args[1],
    makingAmount: l.parsed.args[2].toString(),
    takingAmount: l.parsed.args[3].toString(),
  }));

  const verification = {
    filledOrderHash: orderHash,
    pendingFills: { recipient: pending[0], initiated: pending[1], fulfilled: pending[2] },
    eventCount: eventLogs.length,
    eventLogs,
    lopOrderFilled: lopLogs.map((l) => ({ logIndex: l.logIndex, orderHash: l.orderHash, remainingMakingAmount: l.remaining.toString() })),
    event: eventLogs[0]
      ? { recipient: eventLogs[0].recipient, makingAmount: eventLogs[0].makingAmount, takingAmount: eventLogs[0].takingAmount }
      : null,
    deltas: {
      makerUsdc: (BigInt(before.makerUsdc) - BigInt(after.makerUsdc)).toString(),
      makerWeth: (BigInt(after.makerWeth) - BigInt(before.makerWeth)).toString(),
      settlerUsdc: (BigInt(after.settlerUsdc) - BigInt(before.settlerUsdc)).toString(),
      settlerWeth: (BigInt(before.settlerWeth) - BigInt(after.settlerWeth)).toString(),
    },
    expected: { makingAmount: makingAmount.toString(), takingAmount: takingAmount.toString() },
  };

  const checks = [
    ['postInteraction fired (pendingFills.fulfilled)', verification.pendingFills.fulfilled === true],
    ['pendingFills.recipient == order.receiver', verification.pendingFills.recipient.toLowerCase() === maker.address.toLowerCase()],
    ['OrderFilled emitted by fill() and by postInteraction()', verification.eventCount === 2],
    ['every settler log carries the filled orderHash', eventLogs.length > 0 && eventLogs.every((l) => l.orderHash === orderHash)],
    ['every settler log reports order.receiver', eventLogs.every((l) => l.recipient.toLowerCase() === maker.address.toLowerCase())],
    ['every settler log reports the same makingAmount', eventLogs.every((l) => l.makingAmount === makingAmount.toString())],
    ['every settler log reports the same takingAmount', eventLogs.every((l) => l.takingAmount === takingAmount.toString())],
    ['canonical LOP emitted OrderFilled(orderHash, 0)', lopLogs.some((l) => l.orderHash === orderHash && l.remaining === 0n)],
    ['maker USDC -makingAmount', verification.deltas.makerUsdc === makingAmount.toString()],
    ['maker WETH +takingAmount', verification.deltas.makerWeth === takingAmount.toString()],
    ['settler USDC +makingAmount', verification.deltas.settlerUsdc === makingAmount.toString()],
    ['settler WETH -takingAmount', verification.deltas.settlerWeth === takingAmount.toString()],
  ];
  console.log('\nverification');
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);

  results.fill = {
    tx: tx.hash,
    url: `https://basescan.org/tx/${tx.hash}`,
    status: rc.status,
    block: rc.blockNumber,
    gasUsed: rc.gasUsed.toString(),
    operator: solver.address,
    maker: maker.address,
    before,
    after,
  };
  results.verification = { ...verification, checks: checks.map(([label, ok]) => ({ label, ok })) };
  results.finishedAt = new Date().toISOString();
  results.allPassed = checks.every(([, ok]) => ok);

  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync('scripts/v4/live/proofs/fusion-live.json', JSON.stringify(results, null, 2));
  fs.writeFileSync(`scripts/v4/live/proofs/fusion-live-${Date.now()}.json`, JSON.stringify(results, null, 2));
  console.log('\nwrote scripts/v4/live/proofs/fusion-live.json');
  if (!results.allPassed) process.exitCode = 2;
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  if (e.data && e.data !== '0x') console.error('revert data:', e.data.slice(0, 10));
  process.exit(1);
});
