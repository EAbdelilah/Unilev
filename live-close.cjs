require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const HOOK = "0xe33A630503c640143126BBF222a82689D49b50c8";
const ROUTER = "0xD3360D67E366Cac21a1c18fC9100B93be79e1437";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const SOLVER = "0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037";
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function wait(hash,label){ for(let i=0;i<60;i++){ await sleep(2000); const r=await provider.getTransactionReceipt(hash).catch(()=>null); if(r){ if(r.status===1){console.log("OK",label,"gas",r.gasUsed.toString(),hash);return r;} throw new Error(label+" REVERTED "+hash);} } throw new Error(label+" TIMEOUT "+hash);}
(async () => {
  const router = new ethers.Contract(ROUTER, ["function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)"], wallet);
  const key = [WETH, USDC, 3000, 60, HOOK];
  const tx = await router.closePosition(HOOK, key, wallet.address, SOLVER, 0);
  console.log("close tx", tx.hash);
  await wait(tx.hash, "CLOSE");
  console.log("CLOSED");
})();