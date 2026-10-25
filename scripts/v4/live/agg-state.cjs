const { ethers } = require('ethers');
const { loadEnv, getProvider, loadABIs, USDC, WETH, ROUTER, HOOK, ZEROX, ENSO, KYBER, PARASWAP } = require('./common.cjs');

const env = loadEnv();

(async () => {
  const p = getProvider();
  const abis = loadABIs();
  const router = new ethers.Contract(ROUTER, abis.router, p);
  const hook = new ethers.Contract(HOOK, abis.hook, p);
  const erc20 = new ethers.Contract(USDC, abis.erc20, p);
  const weth = new ethers.Contract(WETH, abis.erc20, p);

  const wallets = {
    owner: new ethers.Wallet(env.PRIVATE_KEY).address,
    solver: new ethers.Wallet(env.SOLVER_PRIVATE_KEY).address,
    trader: new ethers.Wallet(env.TINY_TRADER_PK).address,
  };

  const proxies = {
    ZEROX, ENSO, KYBER, PARASWAP,
    paraTokenProxy: '0x93aAAe79a53759cD164340E4C8766E4Db5331cD7',
  };
  for (const [k, a] of Object.entries(proxies)) {
    console.log('allowedAggregators', k, a, await router.allowedAggregators(a));
  }
  console.log('executorWhitelist(owner)', await router.executorWhitelist(wallets.owner));
  console.log('executorWhitelist(solver)', await router.executorWhitelist(wallets.solver));
  console.log('executorWhitelist(trader)', await router.executorWhitelist(wallets.trader));
  console.log('registeredSolvers(solver)', await router.registeredSolvers(wallets.solver));
  console.log('solverNotionalCap(solver)', (await router.solverNotionalCap(wallets.solver)).toString());

  const poolId = '0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512';
  for (const [k, a] of Object.entries(wallets)) {
    const pos = await hook.positions(poolId, a);
    console.log('position', k, a, JSON.stringify({
      trader: pos[0], collateral: pos[1].toString(), borrowed: pos[2].toString(), lev: pos[3], isLong: pos[4],
    }));
    console.log('  usdc bal', (await erc20.balanceOf(a)).toString(), 'allow->router', (await erc20.allowance(a, ROUTER)).toString());
    console.log('  weth bal', (await weth.balanceOf(a)).toString());
    console.log('  eth', (await p.getBalance(a)).toString());
  }
  console.log('escrow(solver,USDC)', (await router.erc20BorrowEscrow(wallets.solver, USDC)).toString());
})();
