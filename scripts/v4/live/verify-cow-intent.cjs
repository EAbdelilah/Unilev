/**
 * Independent on-chain verification of the two live Base mainnet B2B proofs:
 *
 *   [A] CoW Protocol GPv2 settlement fill  -> EswapCoWSettlement.fillOrder
 *   [B] Direct solver intent fill          -> EswapRouter.swapWithIntent
 *
 * Nothing here trusts the broadcaster: every value is re-read from chain
 * receipts / state and the CoW order is decoded from the broadcast calldata.
 *
 *   node scripts/v4/live/verify-cow-intent.cjs
 */
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const ROUTER = '0xD3360D67E366Cac21a1c18fC9100B93be79e1437';
const COW_SETT = '0xA9b26F6884526E822190204fe7279ee1db34Abd6';
const PM = '0x498581fF718922c3f8e6A244956aF099B2652b2b';

const TX = {
  escrowA: '0xf0360c78b4cb4e594f9e2cec5b39dc507e86b4aeb59f6fc34efbc963e8958bc3',
  cow: '0xd2dab148d807b794ba2931853c18c803edb28fab1cfe8b13b2a225cdeac0f48f',
  escrowB: '0x0cb56a3a6566dc136a93ac899628ab58862e35d5393f91704fb61158f57959df',
  intent: '0x180f452efa7ee76848dd20822ddd2c8887107356ebf3d08717ad4d66878fe7ed',
};

const HOOK_KEY = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };

const abiOf = (f) => {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
};

const coder = ethers.AbiCoder.defaultAbiCoder();
const poolIdOf = (k) =>
  ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks]));

async function waitFor(label, read, ok, tries = 40) {
  let last;
  for (let i = 0; i < tries; i++) {
    last = await read();
    if (ok(last)) return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`timed out confirming ${label} (last=${String(last)})`);
}

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const cow = new ethers.Contract(COW_SETT, abiOf('dashboard/src/abis/EswapCoWSettlement.json'), p);
  const router = new ethers.Contract(ROUTER, abiOf('dashboard/src/abis/EswapRouter.json'), p);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), p);
  const pm = new ethers.Contract(PM, ['function balanceOf(address,uint256) view returns(uint256)'], p);

  const out = { verifiedAt: new Date().toISOString(), rpc: RPC, chainId: 8453, proofs: [] };

  // ── [A] CoW GPv2 settlement fill ───────────────────────────────────────
  const cowTx = await p.getTransaction(TX.cow);
  const cowRc = await p.getTransactionReceipt(TX.cow);
  const decoded = cow.interface.decodeFunctionData('fillOrder', cowTx.data);
  const order = decoded[0];
  const fillParams = decoded[3];

  const orderFilled = cowRc.logs
    .filter((l) => l.address.toLowerCase() === COW_SETT.toLowerCase())
    .map((l) => {
      try {
        return cow.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e && e.name === 'OrderFilled');

  const uid = ethers.keccak256(ethers.hexlify(orderFilled.args.orderUid));
  const filled = await waitFor('filledOrders', () => cow.filledOrders(uid), (v) => v === true);

  const cowPos = await waitFor('cow position', () => hook.positions(poolIdOf(HOOK_KEY), orderFilled.args.owner), (v) => v[1] > 0n);
  const claimId = BigInt(WETH);
  const claims = await pm.balanceOf(HOOK, claimId);

  out.proofs.push({
    id: 'cow-gpv2-settlement',
    route: 'CoW Protocol GPv2 -> EswapCoWSettlement.fillOrder',
    chainId: 8453,
    tx: TX.cow,
    url: `https://basescan.org/tx/${TX.cow}`,
    status: cowRc.status,
    block: cowRc.blockNumber,
    gasUsed: cowRc.gasUsed.toString(),
    gasPriceWei: cowTx.gasPrice ? cowTx.gasPrice.toString() : (cowTx.maxFeePerGas || 0n).toString(),
    relayer: cowTx.from,
    domainSeparator: await cow.domainSeparator(),
    orderUidRaw: orderFilled.args.orderUid,
    orderUidHash: uid,
    orderOwner: orderFilled.args.owner,
    solver: orderFilled.args.solver,
    margin: orderFilled.args.margin.toString(),
    leverage: Number(orderFilled.args.leverage),
    order: {
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      receiver: order.receiver,
      sellAmount: order.sellAmount.toString(),
      buyAmount: order.buyAmount.toString(),
      validTo: Number(order.validTo),
      appData: order.appData,
      appDataJson: await cow.appDataJson(Number(orderFilled.args.leverage)),
      leverageCommitment: await cow.leverageCommitment(Number(orderFilled.args.leverage)),
      feeAmount: order.feeAmount.toString(),
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: order.sellTokenBalance,
      buyTokenBalance: order.buyTokenBalance,
    },
    fillParams: {
      leverage: Number(fillParams.leverage),
      solver: fillParams.solver,
      key: {
        currency0: fillParams.key.currency0,
        currency1: fillParams.key.currency1,
        fee: Number(fillParams.key.fee),
        tickSpacing: Number(fillParams.key.tickSpacing),
        hooks: fillParams.key.hooks,
      },
      standardPoolKey: {
        currency0: fillParams.standardPoolKey.currency0,
        currency1: fillParams.standardPoolKey.currency1,
        fee: Number(fillParams.standardPoolKey.fee),
        tickSpacing: Number(fillParams.standardPoolKey.tickSpacing),
        hooks: fillParams.standardPoolKey.hooks,
      },
    },
    stateAfter: {
      filledOrders: filled,
      position: {
        trader: cowPos[0],
        collateralWethWei: cowPos[1].toString(),
        borrowedUsdc: cowPos[2].toString(),
        leverage: Number(cowPos[3]),
        isLong: cowPos[4],
      },
      hookErc6909WethClaims: claims.toString(),
      escrowUsdcAfter: (await router.erc20BorrowEscrow(orderFilled.args.solver, USDC)).toString(),
    },
    escrowDepositTx: TX.escrowA,
    escrowDepositUrl: `https://basescan.org/tx/${TX.escrowA}`,
  });

  // ── [B] Direct solver intent fill ──────────────────────────────────────
  const inTx = await p.getTransaction(TX.intent);
  const inRc = await p.getTransactionReceipt(TX.intent);
  const [swapParams, trader, intent] = router.interface.decodeFunctionData('swapWithIntent', inTx.data);
  const fillId = ethers.keccak256(coder.encode(['address', 'uint256'], [trader, intent.nonce]));
  const filledIntent = await waitFor('filledIntents', () => router.filledIntents(fillId), (v) => v === true);
  const inPos = await waitFor('intent position', () => hook.positions(poolIdOf(HOOK_KEY), trader), (v) => v[1] > 0n);

  out.proofs.push({
    id: 'direct-solver-intent',
    route: 'EswapRouter.swapWithIntent (permissionless solver, escrow-funded borrow)',
    chainId: 8453,
    tx: TX.intent,
    url: `https://basescan.org/tx/${TX.intent}`,
    status: inRc.status,
    block: inRc.blockNumber,
    gasUsed: inRc.gasUsed.toString(),
    gasPriceWei: inTx.gasPrice ? inTx.gasPrice.toString() : (inTx.maxFeePerGas || 0n).toString(),
    relayer: inTx.from,
    intent: {
      poolId: intent.poolId,
      standardPoolId: intent.standardPoolId,
      zeroForOne: intent.zeroForOne,
      amountSpecified: intent.amountSpecified.toString(),
      leverage: Number(intent.leverage),
      solver: intent.solver,
      deadline: Number(intent.deadline),
      minAmountOut: intent.minAmountOut.toString(),
      nonce: intent.nonce.toString(),
    },
    trader,
    fillId,
    stateAfter: {
      filledIntents: filledIntent,
      position: {
        trader: inPos[0],
        collateralWethWei: inPos[1].toString(),
        borrowedUsdc: inPos[2].toString(),
        leverage: Number(inPos[3]),
        isLong: inPos[4],
      },
      solverNotionalCap: (await router.solverNotionalCap(intent.solver)).toString(),
      escrowUsdcAfter: (await router.erc20BorrowEscrow(intent.solver, USDC)).toString(),
    },
    escrowDepositTx: TX.escrowB,
    escrowDepositUrl: `https://basescan.org/tx/${TX.escrowB}`,
  });

  // ── shared assertions ──────────────────────────────────────────────────
  const a = out.proofs[0];
  const b = out.proofs[1];
  const assert = (cond, msg) => {
    if (!cond) throw new Error('ASSERTION FAILED: ' + msg);
    console.log('  ok  ' + msg);
  };
  console.log('assertions:');
  assert(a.status === 1 && b.status === 1, 'both txs mined with status 1');
  assert(a.stateAfter.filledOrders === true, 'CoW filledOrders[uid] == true (replay-locked)');
  assert(
    a.order.appData.toLowerCase() === ethers.keccak256(ethers.toUtf8Bytes(a.order.appDataJson)).toLowerCase(),
    'order.appData == keccak256(appDataJson(2))',
  );
  assert(a.order.appData.toLowerCase() === a.order.leverageCommitment.toLowerCase(), 'order.appData == leverageCommitment(2)');
  assert(a.order.receiver.toLowerCase() === a.orderOwner.toLowerCase(), 'CoW receiver == swapper');
  assert(a.order.sellToken === USDC && a.order.buyToken === WETH, 'CoW sell USDC -> buy WETH');
  assert(a.fillParams.leverage === 2 && b.intent.leverage === 2, 'both fills at 2x leverage');
  assert(a.stateAfter.position.leverage === 2 && a.stateAfter.position.isLong, 'CoW position is a 2x long');
  assert(b.stateAfter.position.leverage === 2 && b.stateAfter.position.isLong, 'intent position is a 2x long');
  assert(b.stateAfter.filledIntents === true, 'filledIntents[fillId] == true (nonce consumed)');
  assert(b.intent.zeroForOne === false, 'intent direction USDC -> WETH');
  assert(b.intent.minAmountOut === '0', 'intent minAmountOut == 0 as specified');
  assert(b.intent.nonce === '1', 'intent nonce == 1 as specified');
  assert(a.stateAfter.escrowUsdcAfter === '0' && b.stateAfter.escrowUsdcAfter === '0', 'escrow drained by each fill (spent, not idle)');

  fs.mkdirSync('scripts/v4/live/proofs', { recursive: true });
  const file = 'scripts/v4/live/proofs/cow-intent-live.json';
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('\nwrote', file);
}

main().catch((e) => {
  console.error('\nFAILED:', e.shortMessage || e.message);
  process.exit(1);
});
