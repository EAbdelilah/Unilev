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

// Addresses are read from `.env` first, so a redeploy only requires editing
// `.env` (and re-running `node javascript/update-dashboard.js`) instead of
// hunting hardcoded constants across the live-proof scripts. The fallbacks are
// the 2026-10-20 Base deployment and exist only so an un-edited `.env` keeps
// producing a readable error rather than `undefined`.
const _env = loadEnv();
const pick = (key, fallback) => {
  const v = _env[key];
  return v && v.length && v !== '0x0000000000000000000000000000000000000000' ? v : fallback;
};

const RPC = process.env.BASE_RPC_URL || pick('BASE_RPC_URL', 'https://mainnet.base.org');
const CHAIN_ID = 8453;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const PERMIT2 = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const ROUTER = pick('V4_ROUTER_ADDRESS', '0xD3360D67E366Cac21a1c18fC9100B93be79e1437');
const ADAPTER = pick('V4_ADAPTER_ADDRESS', '0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD');
const HOOK = pick('V4_HOOK_ADDRESS', '0xe33A630503c640143126BBF222a82689D49b50c8');
const PRICE_FEED = pick('V4_PRICEFEED_ADDRESS', '0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8');
const COW_SETT = pick('V4_COW_SETTLEMENT_ADDRESS', '0xA9b26F6884526E822190204fe7279ee1db34Abd6');
const UX_SETT = pick('V4_UNISWAPX_SETTLEMENT_ADDRESS', '0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33');
const FI_SETT = pick('V4_ONEINCH_FUSION_SETTLEMENT_ADDRESS', '0xD0F10948E5E987d9A04aDf4014178D65042f672c');
const QUOTER = pick('V4_QUOTER_ADDRESS', '0x36Fb18aFA12AeeB439157699dB478FD60Ffb842E');
const KEEPER = pick('V4_KEEPER_ADDRESS', '0x0000000000000000000000000000000000000000');
const ROUTER_EXT = pick('V4_ROUTER_EXT_ADDRESS', '0x0000000000000000000000000000000000000000');
const USDC_FEED = pick('USDC_TWAP_FEED', '0x879F65DfCF6C0758E1a1a028a6D21bF3DA55cBd9');
// The hook pool id (WETH/USDC 3000/60). Kept in `.env` because it is printed by
// the redeploy and re-deriving it requires the exact hook address + fee tier.
const POOL_ID = pick('POOL_ID', '0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512');
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

module.exports = { loadEnv, getProvider, loadABIs, sleep, bs, out, RPC, CHAIN_ID, USDC, WETH, PERMIT2, ROUTER, ADAPTER, HOOK, PRICE_FEED, COW_SETT, UX_SETT, FI_SETT, QUOTER, KEEPER, ROUTER_EXT, USDC_FEED, POOL_ID, GPV2, ZEROX, ENSO, PARASWAP, KYBER, LOP1INCH, HOOK_FEE, HOOK_TICK, STD_FEE, STD_TICK, POOL_MGR };
