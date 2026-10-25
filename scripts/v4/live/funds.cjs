const { ethers } = require('ethers');
const fs = require('fs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';

(async () => {
  const p = new ethers.JsonRpcProvider(RPC);
  const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns(uint256)'], p);
  const weth = new ethers.Contract(WETH, ['function balanceOf(address) view returns(uint256)'], p);
  const keys = [];
  for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]*(?:PK|PRIVATE_KEY|KEY))\s*=\s*(0x[0-9a-fA-F]{64})\s*$/);
    if (m) keys.push([m[1], m[2]]);
  }
  const seen = new Set();
  for (const [name, pk] of keys) {
    const a = new ethers.Wallet(pk).address;
    if (seen.has(a)) continue;
    seen.add(a);
    const [e, u, w] = await Promise.all([p.getBalance(a), usdc.balanceOf(a), weth.balanceOf(a)]);
    console.log(name.padEnd(24), a, 'ETH', ethers.formatEther(e), 'USDC', ethers.formatUnits(u, 6), 'WETH', ethers.formatEther(w));
  }
  for (const [n, a] of Object.entries({
    HOOK: '0xe33A630503c640143126BBF222a82689D49b50c8',
    ROUTER: '0xD3360D67E366Cac21a1c18fC9100B93be79e1437',
    COW: '0xA9b26F6884526E822190204fe7279ee1db34Abd6',
    UX: '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33',
    FI: '0xD0F10948E5E987d9A04aDf4014178D65042f672c',
    ADAPTER: '0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD',
  })) {
    console.log(n.padEnd(24), a, 'ETH', ethers.formatEther(await p.getBalance(a)), 'USDC', ethers.formatUnits(await usdc.balanceOf(a), 6), 'WETH', ethers.formatEther(await weth.balanceOf(a)));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
