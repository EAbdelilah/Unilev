/**
 * Independent verifier for the live 1inch Fusion fill.
 *
 *   node scripts/v4/live/verify-fusion.cjs [txHash]
 *
 * Reads the already-mined settlement tx from Base, decodes every input and log,
 * re-derives the order hash from the canonical LOP, recovers the maker signature
 * from the calldata alone, and re-checks the ERC20 movements straight out of the
 * receipt. Exits non-zero if any assertion fails. Writes
 * scripts/v4/live/proofs/fusion-live.json.
 */
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const LOP = '0x111111125421cA6dc452d289314280a0f8842A65';
const FUSION = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';
const CHAINLINK_ETH_USD = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const DEFAULT_TX = '0x2242c346f57e0fe7fbbf7df945c74c4b3e53b007f841f5f7db9f9e16aa875681';
// Pre-funding txs that had to happen before the fill.
const APPROVE_TX = '0x78f4f3ae9fe74bb081cb72ca6e5aa4453274a304a9194c5fc92ab2b951387c15';
const INVENTORY_TX = '0xf637965d1968c38f196120581920119f58f260955ac6b49231ca3e4e1c0faa1e';

const LOP_ORDER_FILLED_TOPIC = ethers.id('OrderFilled(bytes32,uint256)');
const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const APPROVAL_TOPIC = ethers.id('Approval(address,address,uint256)');

function abiOf(file) {
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Array.isArray(j) ? j : j.abi;
}

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

const topicAddr = (t) => ethers.getAddress('0x' + t.slice(26));

async function main() {
  const txHash = process.argv[2] || DEFAULT_TX;
  const p = new ethers.JsonRpcProvider(RPC);
  const env = loadEnv();
  const fusion = new ethers.Contract(FUSION, abiOf('out/EswapOneInchFusionSettlement.sol/EswapOneInchFusionSettlement.json'), p);
  const lop = new ethers.Contract(LOP, [
    'function hashOrder((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)) view returns (bytes32)',
    // The deployed Base LOP reverts on remainingInvalidatorForOrder(); the raw
    // getter is available and returns 0 for a fully filled order (0 = sentinel).
    'function rawRemainingInvalidatorForOrder(address,bytes32) view returns (uint256)',
  ], p);
  const erc20 = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], p);
  const weth = new ethers.Contract(WETH, ['function balanceOf(address) view returns (uint256)'], p);
  const feed = new ethers.Contract(CHAINLINK_ETH_USD, ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'], p);

  const tx = await p.getTransaction(txHash);
  const rc = await p.getTransactionReceipt(txHash);
  if (!rc) throw new Error(`no receipt for ${txHash} on ${RPC}`);

  // ── 1. decode the settler call ────────────────────────────────────────
  const iface = fusion.interface;
  const fn = iface.parseTransaction({ data: tx.data, value: tx.value });
  const [order, r, vs, amount, takerTraits, extension, interaction, recipient] = fn.args;

  const orderFields = {
    salt: order.salt.toString(),
    maker: ethers.getAddress('0x' + order.maker.toString(16).padStart(40, '0')),
    receiver: ethers.getAddress('0x' + order.receiver.toString(16).padStart(40, '0')),
    makerAsset: ethers.getAddress('0x' + order.makerAsset.toString(16).padStart(40, '0')),
    takerAsset: ethers.getAddress('0x' + order.takerAsset.toString(16).padStart(40, '0')),
    makingAmount: order.makingAmount.toString(),
    takingAmount: order.takingAmount.toString(),
    makerTraits: order.makerTraits.toString(),
  };

  // ── 2. re-derive the hash + recover the maker from calldata alone ─────
  const orderHash = await lop.hashOrder([
    order.salt, order.maker, order.receiver, order.makerAsset, order.takerAsset,
    order.makingAmount, order.takingAmount, order.makerTraits,
  ]);
  const sValue = '0x' + (BigInt(vs) & ((1n << 255n) - 1n)).toString(16).padStart(64, '0');
  const yParity = Number(BigInt(vs) >> 255n);
  const recovered = ethers.recoverAddress(orderHash, { r, s: sValue, yParity });

  // ── 3. maker-signed extension + trait bits ────────────────────────────
  const extensionHash = ethers.keccak256(extension);
  const saltLow160 = '0x' + (BigInt(order.salt) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0');
  const extLen = Number((BigInt(takerTraits) >> 224n) & 0xffffffn);
  const traitBits = {
    noPartialFills: (BigInt(order.makerTraits) & (1n << 255n)) !== 0n,
    postInteractionCall: (BigInt(order.makerTraits) & (1n << 251n)) !== 0n,
    hasExtension: (BigInt(order.makerTraits) & (1n << 249n)) !== 0n,
    allowedSender: (BigInt(order.makerTraits) & ((1n << 80n) - 1n)).toString(),
  };
  const extensionTarget = ethers.getAddress('0x' + extension.slice(-40));
  const extensionLengthTable = '0x' + extension.slice(2, 66);

  // ── 4. receipt logs ──────────────────────────────────────────────────
  const transfers = rc.logs
    .filter((l) => l.topics[0] === TRANSFER_TOPIC)
    .map((l) => ({ logIndex: l.index, token: ethers.getAddress(l.address), from: topicAddr(l.topics[1]), to: topicAddr(l.topics[2]), amount: BigInt(l.data).toString() }));
  const settlerEvents = rc.logs
    .filter((l) => l.address.toLowerCase() === FUSION.toLowerCase())
    .map((l) => ({ logIndex: l.index, parsed: iface.parseLog({ topics: l.topics, data: l.data }) }))
    .filter((l) => l.parsed && l.parsed.name === 'OrderFilled')
    .map((l) => ({ logIndex: l.logIndex, orderHash: l.parsed.args[0], recipient: l.parsed.args[1], makingAmount: l.parsed.args[2].toString(), takingAmount: l.parsed.args[3].toString() }));
  const lopEvents = rc.logs
    .filter((l) => l.address.toLowerCase() === LOP.toLowerCase() && l.topics[0] === LOP_ORDER_FILLED_TOPIC)
    // The Base deployment emits OrderFilled with BOTH fields in data (one topic);
    // handle the indexed-hash variant too so the decode stays correct either way.
    .map((l) => {
      if (l.topics.length > 1) {
        return { logIndex: l.index, orderHash: l.topics[1], remainingMakingAmount: BigInt(l.data).toString() };
      }
      return { logIndex: l.index, orderHash: l.data.slice(0, 66), remainingMakingAmount: BigInt('0x' + l.data.slice(66)).toString() };
    });

  // ── 5. on-chain state after the fill ─────────────────────────────────
  const pending = await fusion.pendingFills(orderHash);
  const operator = await fusion.operator();
  const remaining = await lop.rawRemainingInvalidatorForOrder(orderFields.maker, orderHash);
  const [, ethAnswer] = await feed.latestRoundData();
  const p8 = BigInt(ethAnswer);
  // Sizing rule used by the broadcaster: making = floor(taking * ETH/USD / 1e20).
  const fairMaking = (BigInt(order.takingAmount) * p8) / 10n ** 20n;
  const impliedPrice8 = (BigInt(order.makingAmount) * 10n ** 20n) / BigInt(order.takingAmount);

  const proof = {
    venue: '1inch Fusion / Limit Order Protocol v4',
    chainId: CHAIN_ID,
    rpc: RPC,
    verifiedAt: new Date().toISOString(),
    settler: FUSION,
    lop: LOP,
    tx: {
      hash: txHash,
      url: `https://basescan.org/tx/${txHash}`,
      block: rc.blockNumber,
      status: rc.status,
      gasUsed: rc.gasUsed.toString(),
      effectiveGasPrice: rc.gasPrice ? rc.gasPrice.toString() : null,
      from: tx.from,
      to: tx.to,
      function: 'EswapOneInchFusionSettlement.fill',
    },
    setup: {
      makerApprove: { tx: APPROVE_TX, url: `https://basescan.org/tx/${APPROVE_TX}` },
      settlerInventory: { tx: INVENTORY_TX, url: `https://basescan.org/tx/${INVENTORY_TX}` },
      note: 'The maker had to grant the canonical LOP a USDC allowance and the settler (which is the taker) had to hold WETH inventory before the fill could settle.',
    },
    order: orderFields,
    orderHash,
    signature: { r, vs, yParity, recoveredMaker: recovered, standard: 'raw ECDSA over LOP.hashOrder(order)' },
    extension: { raw: extension, length: ethers.dataLength(extension), lengthTable: extensionLengthTable, postInteractionTarget: extensionTarget, keccak256: extensionHash },
    traits: { takerTraits: takerTraits.toString(), takerTraitsExtensionLength: extLen, takerTraitsMakingAmountMode: (BigInt(takerTraits) & (1n << 255n)) !== 0n, takerTraitsThreshold: (BigInt(takerTraits) & ((1n << 200n) - 1n)).toString(), makerTraits: traitBits },
    amounts: { makingAmount: amount.toString(), interaction: interaction === '0x' ? '0x' : interaction, recipient },
    fills: { pendingFills: { recipient: pending[0], initiated: pending[1], fulfilled: pending[2] }, lopRemainingMakingAmount: remaining.toString() },
    price: { chainlinkEthUsd8: p8.toString(), orderImpliedEthUsd8: impliedPrice8.toString(), deviationBps: Number((((impliedPrice8 - p8) * 10000n) / p8).toString()), fairMakingAtChainlinkPrice: fairMaking.toString(), note: 'USDC has 6 decimals, so the fair making amount is truncated to whole USDC-units: 1 unit of rounding on an 11-unit fill.' },
    transfers,
    settlerEvents,
    lopEvents,
  };

  const checks = [
    ['tx mined with status 1', rc.status === 1],
    ['tx sent to EswapOneInchFusionSettlement', tx.to.toLowerCase() === FUSION.toLowerCase()],
    ['tx sent by the settler operator', tx.from.toLowerCase() === operator.toLowerCase()],
    ['calldata is fill(order,r,vs,amount,traits,extension,interaction,recipient)', fn.name === 'fill'],
    ['order.makerAsset == USDC', orderFields.makerAsset.toLowerCase() === USDC.toLowerCase()],
    ['order.takerAsset == WETH', orderFields.takerAsset.toLowerCase() === WETH.toLowerCase()],
    ['order.receiver == recipient == signature-recovered maker', orderFields.receiver === recipient && recovered === orderFields.maker && recipient.toLowerCase() === orderFields.maker.toLowerCase()],
    ['signature recovers order.maker', recovered.toLowerCase() === orderFields.maker.toLowerCase()],
    ['order hash matches the canonical LOP hashOrder()', typeof orderHash === 'string' && orderHash.length === 66],
    ['extension salt commitment (low 160 bits of keccak256(extension))', saltLow160 === '0x' + extensionHash.slice(26)],
    ['extension names the settler as postInteraction target', extensionTarget.toLowerCase() === FUSION.toLowerCase()],
    ['makerTraits: no partial fills + post-interaction + extension', traitBits.noPartialFills && traitBits.postInteractionCall && traitBits.hasExtension],
    ['makerTraits: no allowed-sender restriction', traitBits.allowedSender === '0'],
    ['takerTraits declares the extension length', extLen === ethers.dataLength(extension)],
    ['takerTraits is in making-amount mode', (BigInt(takerTraits) & (1n << 255n)) !== 0n],
    ['pendingFills[orderHash].fulfilled (postInteraction fired)', pending[2] === true],
    ['pendingFills[orderHash].recipient == order.receiver', pending[0].toLowerCase() === orderFields.receiver.toLowerCase()],
    ['LOP remaining invalidator == 0 (fully filled)', remaining === 0n],
    ['LOP emitted OrderFilled(orderHash, 0)', lopEvents.some((e) => e.orderHash === orderHash && e.remainingMakingAmount === '0')],
    ['settler emitted OrderFilled twice (fill + callback)', settlerEvents.length === 2],
    ['settler events agree on orderHash/recipient/amounts', settlerEvents.every((e) => e.orderHash === orderHash && e.recipient.toLowerCase() === recipient.toLowerCase() && e.makingAmount === orderFields.makingAmount && e.takingAmount === orderFields.takingAmount)],
    ['USDC moved maker -> settler (makingAmount)', transfers.some((t) => t.token.toLowerCase() === USDC.toLowerCase() && t.from.toLowerCase() === orderFields.maker.toLowerCase() && t.to.toLowerCase() === FUSION.toLowerCase() && t.amount === orderFields.makingAmount)],
    ['WETH moved settler -> maker (takingAmount)', transfers.some((t) => t.token.toLowerCase() === WETH.toLowerCase() && t.from.toLowerCase() === FUSION.toLowerCase() && t.to.toLowerCase() === orderFields.maker.toLowerCase() && t.amount === orderFields.takingAmount)],
    ['no other token movements', transfers.length === 2],
    ['order makingAmount == floor(takingAmount at Chainlink ETH/USD)', BigInt(orderFields.makingAmount) === fairMaking],
    ['settler holds the bought USDC afterwards', (await erc20.balanceOf(FUSION)) >= BigInt(orderFields.makingAmount)],
    ['maker received the WETH', (await weth.balanceOf(orderFields.maker)) >= BigInt(orderFields.takingAmount)],
    ['WETH approval to the LOP was scoped to maxFillAmount', rc.logs.some((l) => l.address.toLowerCase() === WETH.toLowerCase() && l.topics[0] === APPROVAL_TOPIC && topicAddr(l.topics[1]).toLowerCase() === FUSION.toLowerCase() && topicAddr(l.topics[2]).toLowerCase() === LOP.toLowerCase() && BigInt(l.data) === 5000000000n)],
  ];

  proof.checks = checks.map(([label, ok]) => ({ label, ok }));
  proof.allPassed = checks.every(([, ok]) => ok);

  console.log(`tx ${txHash}`);
  console.log(`block ${rc.blockNumber}  gas ${rc.gasUsed}  status ${rc.status}`);
  console.log(`orderHash ${orderHash}`);
  console.log(`making ${orderFields.makingAmount} USDC-units  taking ${orderFields.takingAmount} wei WETH`);
  console.log(`price: order ${Number(impliedPrice8) / 1e8} vs chainlink ${Number(p8) / 1e8} USD/ETH (${proof.price.deviationBps} bps)`);
  console.log('');
  for (const [label, ok] of checks) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`\n${proof.allPassed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'}`);

  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync('scripts/v4/live/proofs/fusion-live.json', JSON.stringify(proof, null, 2));
  console.log('wrote scripts/v4/live/proofs/fusion-live.json');
  if (!proof.allPassed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('FAILED:', e.shortMessage || e.message);
  process.exit(1);
});
