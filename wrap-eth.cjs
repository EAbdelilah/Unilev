require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const WETH = "0x4200000000000000000000000000000000000006";
const abi = ["function deposit() payable", "function balanceOf(address) view returns (uint256)"];
const weth = new ethers.Contract(WETH, abi, wallet);
(async () => {
  const amount = ethers.parseEther("0.00003");
  const tx = await weth.deposit({ value: amount });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  console.log("status", rc.status);
  console.log("WETH balance", ethers.formatEther(await weth.balanceOf(wallet.address)));
})();