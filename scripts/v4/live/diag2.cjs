const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');

const RPC = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const HOOK = '0xe33A630503c640143126BBF222a82689D49b50c8';
const PM = '0x498581fF718922c3f8e6A244956aF099B2652b2b';
const TRADER = '0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c';

const abiOf = (f) => {
  const j = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), f), 'utf8'));
  return Array.isArray(j) ? j : j.abi;
};

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const hook = new ethers.Contract(HOOK, abiOf('dashboard/src/abis/EswapMarginHook.json'), p);
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const hookId = ethers.keccak256(coder.encode(['address', 'address', 'uint24', 'int24', 'address'], [WETH, USDC, 3000, 60, HOOK]));
  const wethId = BigInt(WETH);

  const bal = new ethers.Contract(PM, ['function balanceOf(address,uint256) view returns(uint256)', 'function extsload(bytes32) view returns(bytes32)'], p);
  console.log('hook ERC6909 WETH claims :', (await bal.balanceOf(HOOK, wethId)).toString());
  console.log('hook ERC6909 USDC claims :', (await bal.balanceOf(HOOK, BigInt(USDC))).toString());
  for (const fn of ['protocolFees(address)', 'totalCollateral(address)', 'protocolFeeFor(address)', 'requireStandardPoolKey()']) {
    const f = hook.interface.getFunction(fn);
    if (!f) { console.log(fn, 'no abi'); continue; }
    try {
      const args = fn.includes('(address)') ? [WETH] : [];
      console.log(fn.padEnd(28), (await hook[f.name](...args)).toString());
    } catch (e) { console.log(fn, 'ERR', (e.shortMessage || e.message).slice(0, 100)); }
  }
  try {
    const sk = await hook.standardPoolKeys(hookId);
    console.log('standardPoolKeys           ', JSON.stringify(sk));
  } catch (e) { console.log('standardPoolKeys ERR', (e.shortMessage || e.message).slice(0, 120)); }
  try {
    const pos = await hook.positions(hookId, TRADER);
    console.log('positions(trader)          ', JSON.stringify(pos));
  } catch (e) { console.log('positions ERR', (e.shortMessage || e.message).slice(0, 120)); }
  try {
    console.log('isAuthorizedPool           ', await hook.isAuthorizedPool(hookId));
    console.log('paused                     ', await hook.paused());
  } catch {}
  const weth = new ethers.Contract(WETH, ['function balanceOf(address) view returns(uint256)'], p);
  console.log('hook WETH ERC20            ', (await weth.balanceOf(HOOK)).toString());
  console.log('manager WETH ERC20         ', (await weth.balanceOf(PM)).toString());
}

main().catch((e) => { console.error(e); process.exit(1); });
