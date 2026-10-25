const { ethers } = require('ethers');
const { loadEnv, getProvider, loadABIs, USDC, ROUTER, HOOK, ZEROX, ENSO, KYBER } = require('./common.cjs');

const env = loadEnv();
const HOOK_KEY = { currency0: '0x4200000000000000000000000000000000000006', currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK };
const coder = ethers.AbiCoder.defaultAbiCoder();
const poolId = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [HOOK_KEY.currency0, HOOK_KEY.currency1, HOOK_KEY.fee, HOOK_KEY.tickSpacing, HOOK_KEY.hooks]));

(async () => {
  const p = getProvider();
  const router = new ethers.Contract(ROUTER, loadABIs().router, p);
  const hook = new ethers.Contract(HOOK, loadABIs().hook, p);
  console.log('owner()', await router.owner());
  console.log('poolId  ', poolId);
  const wallets = {
    owner: new ethers.Wallet(env.PRIVATE_KEY).address,
    solver: new ethers.Wallet(env.SOLVER_PRIVATE_KEY).address,
    trader: new ethers.Wallet(env.TINY_TRADER_PK).address,
  };
  for (const [k, a] of Object.entries(wallets)) {
    const pos = await hook.positions(poolId, a);
    console.log(k, a, 'collateral', pos[1].toString(), 'borrowed', pos[2].toString(), 'lev', Number(pos[3]), 'isLong', pos[4]);
  }
  console.log('isAuthorizedPool', await hook.isAuthorizedPool(poolId));
  console.log('reserveFactor', (await hook.reserveFactor()).toString());
  console.log('minCollateralUsd', (await hook.minCollateralUSD?.() ?? 0n).toString?.());
  for (const [k, a] of Object.entries({ ZEROX_ALLOWANCE_HOLDER: '0x0000000000001fF3684f28c67538d4D072C22734', PARA_V6: '0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52', KYBER, ENSO, ZEROX })) {
    console.log('allowed', k, a, await router.allowedAggregators(a));
  }
})();
