/*
 * Live UniswapX fill through EswapUniswapXSettlement on Base mainnet.
 *
 * Mirrors test_UniswapX_RealPriorityOrder_Settles exactly:
 *   swapper signs a Permit2 PermitWitnessTransferFrom over a PriorityOrder;
 *   the settler (operator) calls reactor.execute(SignedOrder); the reactor pulls
 *   input USDC swapper->settler and pushes output WETH settler->recipient.
 *
 * Roles:
 *   swapper / recipient = TINY_TRADER_PK
 *   settler / operator  = SOLVER_PRIVATE_KEY (already owner-set operator)
 *   owner (setPendingRecipient) = PRIVATE_KEY
 *
 * Usage:
 *   node scripts/v4/live/ux-fill.cjs sim        # prep-if-needed + eth_call simulate
 *   node scripts/v4/live/ux-fill.cjs prep       # only prep txs
 *   node scripts/v4/live/ux-fill.cjs broadcast  # prep-if-needed + real fill
 */
const { ethers } = require('ethers');
const { loadEnv } = require('./env.cjs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const UX = '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33';
const REACTOR = '0x000000001Ec5656dcdB24D90DFa42742738De729';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const CHAIN_ID = 8453n;

const IN_AMOUNT = 1000n;            // 0.001 USDC
const OUT_AMOUNT = 2000000000n;     // 2e9 wei WETH (below maxFillAmount 5e9)

const uxAbi = [
  'function setPendingRecipient(address) external',
  'function pendingRecipient() view returns (address)',
  'function operator() view returns (address)',
  'function owner() view returns (address)',
  'function maxFillAmount() view returns (uint256)',
  'function fill((bytes order, bytes sig) calldata order) external payable',
];
const erc20 = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
];

const TYPEHASH = {
  orderInfo: ethers.id('OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)'),
  input: ethers.id('PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)'),
  output: ethers.id('PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)'),
  tokenPermissions: ethers.id('TokenPermissions(address token,uint256 amount)'),
  permit2Domain: ethers.id('EIP712Domain(string name,uint256 chainId,address verifyingContract)'),
};

const ORDER_TUPLE = 'tuple(tuple(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData) info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,tuple(address token,uint256 amount,uint256 mpsPerPriorityFeeWei) input,tuple(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)[] outputs,tuple(uint256 auctionTargetBlock) cosignerData,bytes cosignature)';
const coder = ethers.AbiCoder.defaultAbiCoder();

function priorityOrderTypehash() {
  return ethers.keccak256(ethers.toUtf8Bytes(
    'PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)' +
    'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)' +
    'PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)' +
    'PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)'
  ));
}

function priorityWitnessType() {
  return (
    'PriorityOrder witness)' +
    'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)' +
    'PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)' +
    'PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)' +
    'PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)' +
    'TokenPermissions(address token,uint256 amount)'
  );
}

function hashOrder(o) {
  const infoHash = ethers.keccak256(coder.encode(
    ['bytes32','address','address','uint256','uint256','address','bytes32'],
    [TYPEHASH.orderInfo, o.info.reactor, o.info.swapper, o.info.nonce, o.info.deadline,
     o.info.additionalValidationContract, ethers.keccak256(o.info.additionalValidationData)]
  ));
  const inputHash = ethers.keccak256(coder.encode(
    ['bytes32','address','uint256','uint256'],
    [TYPEHASH.input, o.input.token, o.input.amount, o.input.mpsPerPriorityFeeWei]
  ));
  const outputHashes = o.outputs.map((x) => ethers.keccak256(coder.encode(
    ['bytes32','address','uint256','uint256','address'],
    [TYPEHASH.output, x.token, x.amount, x.mpsPerPriorityFeeWei, x.recipient]
  )));
  const outputsHash = ethers.keccak256(ethers.concat(outputHashes));
  return ethers.keccak256(coder.encode(
    ['bytes32','bytes32','address','uint256','uint256','bytes32','bytes32'],
    [priorityOrderTypehash(), infoHash, o.cosigner, o.auctionStartBlock, o.baselinePriorityFeeWei, inputHash, outputsHash]
  ));
}

function permit2Digest(o, orderHash) {
  const tokenPermissionsHash = ethers.keccak256(coder.encode(
    ['bytes32','address','uint256'],
    [TYPEHASH.tokenPermissions, o.input.token, o.input.amount]
  ));
  const permitTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,' + priorityWitnessType()
  ));
  const structHash = ethers.keccak256(coder.encode(
    ['bytes32','bytes32','address','uint256','uint256','bytes32'],
    [permitTypeHash, tokenPermissionsHash, REACTOR, o.info.nonce, o.info.deadline, orderHash]
  ));
  const domain = ethers.keccak256(coder.encode(
    ['bytes32','bytes32','uint256','address'],
    [TYPEHASH.permit2Domain, ethers.id('Permit2'), CHAIN_ID, PERMIT2]
  ));
  return ethers.keccak256(ethers.concat(['0x1901', domain, structHash]));
}

function buildOrder(swapper, blockNumber) {
  return {
    info: {
      reactor: REACTOR,
      swapper,
      nonce: (1n << 255n) | BigInt('0x' + Math.floor(Math.random() * 1e12).toString(16)),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 1800),
      additionalValidationContract: UX,
      additionalValidationData: '0x',
    },
    cosigner: ethers.ZeroAddress,
    auctionStartBlock: BigInt(Math.max(blockNumber - 2, 0)),
    baselinePriorityFeeWei: 0n,
    input: { token: USDC, amount: IN_AMOUNT, mpsPerPriorityFeeWei: 0n },
    outputs: [{ token: WETH, amount: OUT_AMOUNT, mpsPerPriorityFeeWei: 0n, recipient: swapper }],
    cosignerData: { auctionTargetBlock: 0n },
    cosignature: '0x',
  };
}

async function main() {
  const mode = process.argv[2] || 'sim';
  const env = loadEnv();
  const pkOwner = env.PRIVATE_KEY;
  const pkSolver = env.SOLVER_PRIVATE_KEY;
  const pkTrader = env.TINY_TRADER_PK;
  if (!pkOwner || !pkSolver || !pkTrader) throw new Error('missing keys in .env');

  const p = new ethers.JsonRpcProvider(RPC);
  const owner = new ethers.Wallet(pkOwner, p);
  const solver = new ethers.Wallet(pkSolver, p);
  const trader = new ethers.Wallet(pkTrader, p);
  const ux = new ethers.Contract(UX, uxAbi, p);
  const usdc = new ethers.Contract(USDC, erc20, p);
  const weth = new ethers.Contract(WETH, erc20, p);

  console.log('mode:', mode);
  console.log('owner ', owner.address);
  console.log('solver', solver.address, '(operator/filler)');
  console.log('trader', trader.address, '(swapper/recipient)');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const send = async (label, fn, over = {}) => {
    const tx = await fn(over);
    console.log(`${label} tx ${tx.hash}`);
    const rc = await tx.wait();
    console.log(`  mined block ${rc.blockNumber} gas ${rc.gasUsed}`);
    await sleep(800);
    return rc;
  };

  // ---- prep 1: set pendingRecipient = trader (owner tx) ----
  let pr = await ux.pendingRecipient();
  if (pr.toLowerCase() !== trader.address.toLowerCase()) {
    await send('setPendingRecipient', (o) => ux.connect(owner).setPendingRecipient(trader.address, { gasLimit: 120000n, ...o }));
  } else {
    console.log('pendingRecipient already = trader');
  }

  // ---- prep 2: fund settler with WETH output ----
  const uxWeth = await weth.balanceOf(UX);
  console.log('settler WETH:', uxWeth.toString());
  if (uxWeth < OUT_AMOUNT) {
    await send('fundWETH', (o) => weth.connect(solver).transfer(UX, OUT_AMOUNT, { gasLimit: 90000n, ...o }));
  } else {
    console.log('settler already funded');
  }

  // ---- prep 3: trader approves Permit2 for USDC ----
  const allowance = await usdc.allowance(trader.address, PERMIT2);
  console.log('trader->Permit2 USDC allowance:', allowance.toString());
  if (allowance < IN_AMOUNT) {
    await send('approvePermit2', (o) => usdc.connect(trader).approve(PERMIT2, ethers.MaxUint256, { gasLimit: 90000n, ...o }));
  } else {
    console.log('Permit2 already approved');
  }

  // ---- build + sign order ----
  const blockNumber = await p.getBlockNumber();
  const order = buildOrder(trader.address, blockNumber);
  const orderHash = hashOrder(order);
  const digest = permit2Digest(order, orderHash);
  const sigObj = trader.signingKey.sign(digest);
  const sig = ethers.concat([sigObj.r, sigObj.s, ethers.toBeHex(sigObj.v, 1)]);
  const encoded = coder.encode([ORDER_TUPLE], [order]);
  console.log('orderHash', orderHash);
  console.log('deadline  ', order.info.deadline.toString(), 'auctionStart', order.auctionStartBlock.toString());

  const fillData = ux.interface.encodeFunctionData('fill', [[encoded, sig]]);

  // ---- preflight eth_call from solver (operator) ----
  console.log('--- eth_call fill (from solver) ---');
  try {
    const ret = await p.call({ from: solver.address, to: UX, data: fillData });
    console.log('eth_call OK, ret:', ret);
  } catch (e) {
    console.log('eth_call REVERT:', (e.shortMessage || e.message || '').slice(0, 300));
    if (e.data) console.log('revert data:', e.data);
    if (process.env.FORCE !== '1') { console.log('aborting before fill broadcast (set FORCE=1 to override)'); return; }
  }

  if (mode !== 'broadcast') { console.log('prep/sim complete (no fill sent)'); return; }

  // ---- broadcast fill ----
  console.log('--- broadcasting fill ---');
  const tx = await ux.connect(solver).fill([encoded, sig], { gasLimit: 800000n });
  console.log('fill tx', tx.hash);
  const rc = await tx.wait();
  console.log('fill mined block', rc.blockNumber, 'gas', rc.gasUsed, 'status', rc.status);
  console.log(JSON.stringify({ fillTx: tx.hash, orderHash, block: rc.blockNumber, gas: rc.gasUsed.toString() }));
}

main().catch((e) => { console.error('ERR', e.shortMessage || e.message || e); process.exit(1); });
