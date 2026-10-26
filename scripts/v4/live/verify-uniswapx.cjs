/**
 * Independent, read-only verifier for the live UniswapX PriorityOrder fill
 * through EswapUniswapXSettlement (Base 8453).
 *
 *   node scripts/v4/live/verify-uniswapx.cjs [txHash] [expectedOrderHash]
 *
 * Re-derives everything from the mined tx alone: decodes fill(order, sig),
 * re-hashes the PriorityOrder with the reactor's EIP-712 rules, recovers the
 * swapper from the Permit2 witness signature, checks the reactor's Fill event
 * for the same order hash, and rebuilds the ERC-20 movements from the receipt.
 * Writes scripts/v4/live/proofs/uniswapx-live.json and exits non-zero on FAIL.
 */
const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453n;
const USDC = ethers.getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
const WETH = ethers.getAddress('0x4200000000000000000000000000000000000006');
const UX = ethers.getAddress('0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33');
const REACTOR = ethers.getAddress('0x000000001Ec5656dcdB24D90DFa42742738De729');
const PERMIT2 = ethers.getAddress('0x000000000022D473030F116dDEE9F6B43aC78BA3');
const TX = process.argv[2] || '0x649d1c9977f14578ddc4319b72e04b6e339b74e3967d3d19c962473921447506';
const EXPECTED_HASH = (process.argv[3] || '0x8f8bc916b5749e9eb0f83fd5b3c4041801d606388093860e7a0e8f25e04e32a0').toLowerCase();

const coder = ethers.AbiCoder.defaultAbiCoder();
const TYPEHASH = {
  orderInfo: ethers.id('OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)'),
  input: ethers.id('PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)'),
  output: ethers.id('PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)'),
  tokenPermissions: ethers.id('TokenPermissions(address token,uint256 amount)'),
  permit2Domain: ethers.id('EIP712Domain(string name,uint256 chainId,address verifyingContract)'),
};
const ORDER_TUPLE = 'tuple(tuple(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData) info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,tuple(address token,uint256 amount,uint256 mpsPerPriorityFeeWei) input,tuple(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)[] outputs,tuple(uint256 auctionTargetBlock) cosignerData,bytes cosignature)';

const priorityOrderTypehash = () => ethers.keccak256(ethers.toUtf8Bytes(
  'PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)' +
  'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)' +
  'PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)' +
  'PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)'));
const priorityWitnessType = () =>
  'PriorityOrder witness)' +
  'OrderInfo(address reactor,address swapper,uint256 nonce,uint256 deadline,address additionalValidationContract,bytes additionalValidationData)' +
  'PriorityInput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei)' +
  'PriorityOrder(OrderInfo info,address cosigner,uint256 auctionStartBlock,uint256 baselinePriorityFeeWei,PriorityInput input,PriorityOutput[] outputs)' +
  'PriorityOutput(address token,uint256 amount,uint256 mpsPerPriorityFeeWei,address recipient)' +
  'TokenPermissions(address token,uint256 amount)';

function hashOrder(o) {
  const infoHash = ethers.keccak256(coder.encode(
    ['bytes32', 'address', 'address', 'uint256', 'uint256', 'address', 'bytes32'],
    [TYPEHASH.orderInfo, o.info.reactor, o.info.swapper, o.info.nonce, o.info.deadline,
      o.info.additionalValidationContract, ethers.keccak256(o.info.additionalValidationData)]));
  const inputHash = ethers.keccak256(coder.encode(['bytes32', 'address', 'uint256', 'uint256'],
    [TYPEHASH.input, o.input.token, o.input.amount, o.input.mpsPerPriorityFeeWei]));
  const outputsHash = ethers.keccak256(ethers.concat(o.outputs.map((x) => ethers.keccak256(coder.encode(
    ['bytes32', 'address', 'uint256', 'uint256', 'address'],
    [TYPEHASH.output, x.token, x.amount, x.mpsPerPriorityFeeWei, x.recipient])))));
  return ethers.keccak256(coder.encode(
    ['bytes32', 'bytes32', 'address', 'uint256', 'uint256', 'bytes32', 'bytes32'],
    [priorityOrderTypehash(), infoHash, o.cosigner, o.auctionStartBlock, o.baselinePriorityFeeWei, inputHash, outputsHash]));
}

function permit2Digest(o, orderHash) {
  const tokenPermissionsHash = ethers.keccak256(coder.encode(['bytes32', 'address', 'uint256'],
    [TYPEHASH.tokenPermissions, o.input.token, o.input.amount]));
  const permitTypeHash = ethers.keccak256(ethers.toUtf8Bytes(
    'PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,' + priorityWitnessType()));
  const structHash = ethers.keccak256(coder.encode(['bytes32', 'bytes32', 'address', 'uint256', 'uint256', 'bytes32'],
    [permitTypeHash, tokenPermissionsHash, REACTOR, o.info.nonce, o.info.deadline, orderHash]));
  const domain = ethers.keccak256(coder.encode(['bytes32', 'bytes32', 'uint256', 'address'],
    [TYPEHASH.permit2Domain, ethers.id('Permit2'), CHAIN_ID, PERMIT2]));
  return ethers.keccak256(ethers.concat(['0x1901', domain, structHash]));
}

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const tx = await p.getTransaction(TX);
  const rc = await p.getTransactionReceipt(TX);
  if (!tx || !rc) throw new Error(`missing tx/receipt for ${TX} on ${RPC}`);
  const ux = new ethers.Interface(['function fill((bytes order, bytes sig) order) external payable']);
  const fn = ux.parseTransaction({ data: tx.data, value: tx.value });
  const [encoded, sig] = fn.args[0];
  const [o] = coder.decode([ORDER_TUPLE], encoded);
  const order = { info: { reactor: o.info.reactor, swapper: o.info.swapper, nonce: o.info.nonce, deadline: o.info.deadline, additionalValidationContract: o.info.additionalValidationContract, additionalValidationData: o.info.additionalValidationData },
    cosigner: o.cosigner, auctionStartBlock: o.auctionStartBlock, baselinePriorityFeeWei: o.baselinePriorityFeeWei,
    input: { token: o.input.token, amount: o.input.amount, mpsPerPriorityFeeWei: o.input.mpsPerPriorityFeeWei },
    outputs: o.outputs.map((x) => ({ token: x.token, amount: x.amount, mpsPerPriorityFeeWei: x.mpsPerPriorityFeeWei, recipient: x.recipient })) };

  const orderHash = hashOrder(order);
  const digest = permit2Digest(order, orderHash);
  const recovered = ethers.recoverAddress(digest, { r: ethers.hexlify(sig.slice(0, 66)), s: ethers.hexlify('0x' + sig.slice(66, 130)), v: parseInt(sig.slice(130, 132), 16) });

  const transfers = rc.logs.filter((l) => l.topics[0] === ethers.id('Transfer(address,address,uint256)') && l.topics.length === 3)
    .map((l) => ({ token: ethers.getAddress(l.address), from: ethers.getAddress('0x' + l.topics[1].slice(26)), to: ethers.getAddress('0x' + l.topics[2].slice(26)), amount: BigInt(l.data) }));
  const usdcIn = transfers.filter((t) => t.token === USDC && t.to === UX);
  const wethOut = transfers.filter((t) => t.token === WETH && t.from === UX);
  const fillEvents = rc.logs.filter((l) => l.address.toLowerCase() === REACTOR.toLowerCase());
  const reactorOrderHashes = fillEvents.map((l) => l.topics[1]).filter(Boolean);
  const block = await p.getBlock(rc.blockNumber);
  const wethUxAfter = await new ethers.Contract(WETH, ['function balanceOf(address) view returns (uint256)'], p).balanceOf(UX, { blockTag: rc.blockNumber });

  const checks = [
    ['tx mined with status 1', rc.status === 1],
    ['tx sent to the EswapUniswapXSettlement', tx.to.toLowerCase() === UX.toLowerCase()],
    ['tx sent by the solver operator', tx.from.toLowerCase() === '0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037'.toLowerCase()],
    ['calldata is fill((bytes order, bytes sig))', fn.name === 'fill'],
    ['re-derived order hash == reported order hash', orderHash.toLowerCase() === EXPECTED_HASH],
    ['Permit2 witness signature recovers the swapper', recovered === order.info.swapper],
    ['order reactor == UniswapX PriorityOrderReactor', order.info.reactor === REACTOR],
    ['order input == USDC 1000 units', order.input.token === USDC && order.input.amount === 1000n],
    ['order output == WETH 2e9 wei to the swapper', order.outputs.length === 1 && order.outputs[0].token === WETH && order.outputs[0].amount === 2000000000n && order.outputs[0].recipient === order.info.swapper],
    ['fill inside the order deadline', block.timestamp <= Number(order.info.deadline)],
    ['reactor logged a fill for this order hash', reactorOrderHashes.some((h) => h.toLowerCase() === orderHash.toLowerCase())],
    ['USDC moved swapper -> settler == input amount', usdcIn.length === 1 && usdcIn[0].from === order.info.swapper && usdcIn[0].amount === order.input.amount],
    ['WETH moved settler -> swapper == output amount', wethOut.length === 1 && wethOut[0].to === order.info.swapper && wethOut[0].amount === order.outputs[0].amount],
    ['settler holds no WETH after the fill block', wethUxAfter === 0n],
  ];

  const out = {
    chainId: 8453, rpc: RPC, verifiedAt: new Date().toISOString(),
    tx: { hash: TX, block: rc.blockNumber, timestamp: block.timestamp, gasUsed: rc.gasUsed.toString(), effectiveGasPrice: rc.gasPrice?.toString() ?? null, from: tx.from, to: tx.to, function: fn.name },
    orderHash, digest, swapper: order.info.swapper, nonce: order.info.nonce.toString(), deadline: order.info.deadline.toString(),
    reactorFillTopics: reactorOrderHashes,
    checks: checks.map(([label, ok]) => ({ label, ok })),
    allPassed: checks.every(([, ok]) => ok),
  };
  for (const c of out.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}`);
  console.log(`\n${out.allPassed ? 'ALL CHECKS PASSED' : 'CHECKS FAILED'} (${checks.filter(([, ok]) => ok).length}/${checks.length})`);
  console.log(`re-derived order hash ${orderHash}`);
  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  fs.writeFileSync('scripts/v4/live/proofs/uniswapx-live.json', JSON.stringify(out, null, 2));
  console.log('wrote scripts/v4/live/proofs/uniswapx-live.json');
  if (!out.allPassed) process.exitCode = 1;
})().catch((e) => { console.error('FAILED:', e.shortMessage || e.message); process.exit(1); });
