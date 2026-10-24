const { ethers } = require('ethers');
const { loadEnv } = require('./env.cjs');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const UX = '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33';
const FI = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';

const erc20 = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const ux = new ethers.Interface([
  'function pendingRecipient() view returns (address)',
  'function operator() view returns (address)',
  'function owner() view returns (address)',
]);

async function bal(p, tok, who) {
  const r = await p.call({ to: tok, data: erc20.encodeFunctionData('balanceOf', [who]) });
  return BigInt(r);
}

(async () => {
  const env = loadEnv();
  const p = new ethers.JsonRpcProvider(RPC);
  const who = {};
  for (const k of ['PRIVATE_KEY', 'SOLVER_PRIVATE_KEY', 'TRADER_PK', 'TINY_TRADER_PK']) {
    if (env[k]) {
      try { who[k] = new ethers.Wallet(env[k]).address; } catch { who[k] = 'INVALID'; }
    }
  }
  console.log('addresses:', who);
  const targets = { ...who };
  for (const [k, a] of Object.entries(targets)) {
    if (!a || a === 'INVALID') continue;
    await new Promise(r => setTimeout(r, 350));
    const usdc = await bal(p, USDC, a);
    await new Promise(r => setTimeout(r, 200));
    const weth = await bal(p, WETH, a);
    await new Promise(r => setTimeout(r, 200));
    const eth = await p.getBalance(a);
    console.log(`${k} ${a} USDC=${usdc} WETH=${weth} ETH=${eth}`);
  }
  await new Promise(r => setTimeout(r, 300));
  console.log('UX.pendingRecipient', ux.decodeFunctionResult('pendingRecipient', await p.call({ to: UX, data: ux.encodeFunctionData('pendingRecipient') }))[0]);
  await new Promise(r => setTimeout(r, 300));
  console.log('UX.operator', ux.decodeFunctionResult('operator', await p.call({ to: UX, data: ux.encodeFunctionData('operator') }))[0]);
  await new Promise(r => setTimeout(r, 300));
  console.log('UX.owner', ux.decodeFunctionResult('owner', await p.call({ to: UX, data: ux.encodeFunctionData('owner') }))[0]);
  await new Promise(r => setTimeout(r, 300));
  console.log('UX WETH', await bal(p, WETH, UX));
  await new Promise(r => setTimeout(r, 300));
  console.log('FI WETH', await bal(p, WETH, FI));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
