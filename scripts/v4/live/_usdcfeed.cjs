const ADDR = require('./common.cjs');
﻿const { ethers } = require('ethers');
(async () => {
  const p = new ethers.JsonRpcProvider('https://mainnet.base.org', 8453, { staticNetwork: true });
  const code = await p.getCode(ADDR.USDC_FEED);
  const iface = new ethers.Interface([
    'function pool() view returns (address)',
    'function ethUsdFeed() view returns (address)',
    'function window() view returns (uint32)',
    'function maxEthFeedAge() view returns (uint256)',
    'function usdc() view returns (address)',
    'function weth() view returns (address)',
    'function decimals() view returns (uint8)',
    'function description() view returns (string)',
    'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  ]);
  for (const f of iface.fragments) {
    const sel = iface.getFunction(f.name).selector.slice(2);
    console.log(f.name.padEnd(18), '0x' + sel, code.includes(sel) ? 'PRESENT' : 'ABSENT');
  }
  console.log('runtime bytes =', (code.length - 2) / 2);
})().catch(e => { console.error('FAIL', e.shortMessage || e.message); process.exit(1); });
