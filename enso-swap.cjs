require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const amountIn = "20000000000000"; // 0.00002 WETH
(async () => {
  const url = `https://api.enso.build/api/v1/shortcuts/bundle?chainId=8453&fromAddress=${wallet.address}&routingStrategy=router&receiver=${wallet.address}`;
  const r = await fetch(url, { method:"POST", headers:{Authorization:`Bearer ${process.env.ENSO_API_KEY}`,"Content-Type":"application/json"}, body: JSON.stringify([{protocol:"enso",action:"route",args:{tokenIn:"0x4200000000000000000000000000000000000006",tokenOut:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",amountIn,slippage:"50",receiver:wallet.address}}]) });
  const body = await r.json();
  console.log("status", r.status);
  if (!body.tx) { console.log(JSON.stringify(body).slice(0,500)); return; }
  const tx = await wallet.sendTransaction({ to: body.tx.to, data: body.tx.data, value: BigInt(body.tx.value||0), gasLimit: 300000n });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  console.log("status", rc.status, "gas", rc.gasUsed.toString());
  const usdc = new ethers.Contract("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ["function balanceOf(address) view returns (uint256)"], provider);
  console.log("USDC balance", ethers.formatUnits(await usdc.balanceOf(wallet.address), 6));
})();