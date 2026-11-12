const ADDR = require('./common.cjs');
const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true });
  const targets = {
    EswapMarginHook: ADDR.HOOK,
    EswapRouter: ADDR.ROUTER,
    EswapLeverageAdapter: ADDR.ADAPTER,
    PriceFeed: ADDR.PRICE_FEED,
    UsdcTwapFeed: ADDR.USDC_FEED,
    EswapCoWSettlement: ADDR.COW_SETT,
    EswapUniswapXSettlement: ADDR.UX_SETT,
    EswapOneInchFusionSettlement: ADDR.FI_SETT,
  };
  for (const [n, a] of Object.entries(targets)) {
    const c = await p.getCode(a);
    const size = (c.length - 2) / 2;
    console.log(n.padEnd(30), String(size).padStart(6), size > 24576 ? 'OVER EIP-170' : 'ok');
  }
})().catch(e => { console.error('FAIL', e.shortMessage || e.message); process.exit(1); });
