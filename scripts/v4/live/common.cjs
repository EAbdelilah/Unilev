const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

function loadEnv() {
  const txt = fs.readFileSync(path.resolve(process.cwd(), '.env'), 'utf8');
  const env = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const ROUTER = '0xD3360D67E366Cac21a1c18fC9100B93be79e1437';
const ADAPTER = '0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const COW_SETT = '0xA9b26F6884526E822190204fe7279ee1db34Abd6';
const UX_SETT = '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33';
const FI_SETT = '0xD0F10948E5E987d9A04aDf4014178D65042f672c';
const GPV2 = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41';
const ZEROX = '0xDef1C0ded9bec7F1a1670819833240f027b25EfF';
const ENSO = '0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf';
const PARASWAP = '0x6A000F20005980200259B80c5102003040001068';
const KYBER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
const LOP1INCH = '0x111111125421cA6dc452d289314280a0f8842A65';
const HOOK_FEE = 3000, HOOK_TICK = 60, STD_FEE = 500, STD_TICK = 10;
const POOL_MGR = '0x498581fF718922c3f8e6A244956aF099B2652b2b';

function getProvider() { return new ethers.JsonRpcProvider(RPC); }
function loadABIs() {
  const load = (f) => JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'));
  return {
    router: (load('dashboard/src/abis/EswapRouter.json').abi || load('dashboard/src/abis/EswapRouter.json')),
    adapter: (load('dashboard/src/abis/EswapLeverageAdapter.json').abi || load('dashboard/src/abis/EswapLeverageAdapter.json')),
    cow: (load('dashboard/src/abis/EswapCoWSettlement.json').abi || load('dashboard/src/abis/EswapCoWSettlement.json')),
    hook: (load('dashboard/src/abis/EswapMarginHook.json').abi || load('dashboard/src/abis/EswapMarginHook.json')),
    erc20: ['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)','function transfer(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)'],
  };
}
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
function bs(tx){ return `https://basescan.org/tx/${tx}`; }
function out(name, obj){ const p = path.resolve(process.cwd(),'scripts/v4/live/proofs',name); fs.writeFileSync(p, JSON.stringify(obj,null,2)); console.log('saved', p); }

module.exports = { loadEnv, getProvider, loadABIs, sleep, bs, out, RPC, CHAIN_ID, USDC, WETH, PERMIT2, ROUTER, ADAPTER, HOOK, COW_SETT, UX_SETT, FI_SETT, GPV2, ZEROX, ENSO, PARASWAP, KYBER, LOP1INCH, HOOK_FEE, HOOK_TICK, STD_FEE, STD_TICK, POOL_MGR };
