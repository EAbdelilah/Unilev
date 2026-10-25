const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const ROUTER = '0xD3360D67E366Cac21a1c18fC9100B93be79e1437';
const COW_SETT = '0xA9b26F6884526E822190204fe7279ee1db34Abd6';
const SOLVER = '0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037';
const TRADER = '0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c';

const abiOf = (f) => {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
};

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), p);
  const router = new ethers.Contract(ROUTER, abiOf('dashboard/src/abis/EswapRouter.json'), p);
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)'], p);

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const hookKey = { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
  const hookId = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [WETH, USDC, 3000, 60, HOOK]));
  const stdKeyAsSummary = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [WETH, USDC, 500, 10, ethers.ZeroAddress]));
  const stdKey3000 = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [WETH, USDC, 3000, 60, ethers.ZeroAddress]));

  console.log('hookId', hookId);

  const tries = [
    ['standardPoolKey(bytes32)', [hookId]],
    ['authorizedPools(bytes32)', [hookId]],
    ['baseCurrency(bytes32)', [hookId]],
    ['router()', []],
    ['owner()', []],
  ];
  for (const [sig, args] of tries) {
    try {
      const fn = hook.interface.getFunction(sig);
      if (!fn) { console.log(sig, '-> no such fn in ABI'); continue; }
      const r = await hook[fn.name](...args);
      console.log(sig, '->', typeof r === 'object' ? JSON.stringify(r) : r.toString());
    } catch (e) {
      console.log(sig, 'ERR', (e.shortMessage || e.message).slice(0, 120));
    }
  }

  // standard key for 500/10 and 3000/60: check pool liquidity via quote on router
  const quoterAbi = ['function quoteExactInput((address,address,uint24,int24,address) key,bool zeroForOne,int128 amountIn,uint8 leverage) view returns (uint256 amountOut,uint256 priceImpactBps)'];
  for (const [name, fee, tick] of [['500/10', 500, 10], ['3000/60', 3000, 60]]) {
    try {
      const q = await p.call({
        to: ROUTER,
        data: new ethers.Interface(quoterAbi).encodeFunctionData('quoteExactInput', [
          [WETH, USDC, fee, tick, ethers.ZeroAddress], false, 10_000_000n, 2,
        ]),
      });
      console.log(`std ${name} quote on 10 USDC @2x:`, ethers.dataSlice(q, 0, 32), ethers.dataSlice(q, 32, 64), 'OK');
    } catch (e) {
      console.log(`std ${name} quote ERR`, (e.shortMessage || e.message).slice(0, 160));
    }
  }

  console.log('solver usdc        ', (await usdc.balanceOf(SOLVER)).toString());
  console.log('solver->router allw', (await usdc.allowance(SOLVER, ROUTER)).toString());
  console.log('trader usdc        ', (await usdc.balanceOf(TRADER)).toString());
  console.log('trader->router allw', (await usdc.allowance(TRADER, ROUTER)).toString());
  console.log('router usdc        ', (await usdc.balanceOf(ROUTER)).toString());
  console.log('cow usdc           ', (await usdc.balanceOf(COW_SETT)).toString());
  console.log('hook usdc          ', (await usdc.balanceOf(HOOK)).toString());
  console.log('PM usdc            ', (await usdc.balanceOf('0x498581fF718922c3f8e6A244956aF099B2652b2b')).toString());
  console.log('stdKey(500/10)     ', stdKeyAsSummary);
  console.log('stdKey(3000/60)    ', stdKey3000);
  console.log('registeredSolvers  ', await router.registeredSolvers(SOLVER));
  console.log('solverNotionalCap  ', (await router.solverNotionalCap(SOLVER)).toString());
  try { console.log('allowedAggregators ', await router.allowedAggregators('0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf')); } catch {}
}

main().catch((e) => { console.error(e); process.exit(1); });
