const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true });
  const targets = {
    EswapMarginHook: '0xe33A630503c640143126BBF222a82689D49b50c8',
    EswapRouter: '0xD3360D67E366Cac21a1c18fC9100B93be79e1437',
    EswapLeverageAdapter: '0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD',
    PriceFeed: '0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8',
    UsdcTwapFeed: '0x879F65DfCF6C0758E1a1a028a6D21bF3DA55cBd9',
    EswapCoWSettlement: '0xA9b26F6884526E822190204fe7279ee1db34Abd6',
    EswapUniswapXSettlement: '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33',
    EswapOneInchFusionSettlement: '0xD0F10948E5E987d9A04aDf4014178D65042f672c',
  };
  for (const [n, a] of Object.entries(targets)) {
    const c = await p.getCode(a);
    const size = (c.length - 2) / 2;
    console.log(n.padEnd(30), String(size).padStart(6), size > 24576 ? 'OVER EIP-170' : 'ok');
  }
})().catch(e => { console.error('FAIL', e.shortMessage || e.message); process.exit(1); });
