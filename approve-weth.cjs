require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const WETH = "0x4200000000000000000000000000000000000006";
const ENSO = "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf";
const abi = ["function approve(address,uint256) returns (bool)"];
const weth = new ethers.Contract(WETH, abi, wallet);
(async () => {
  const tx = await weth.approve(ENSO, ethers.MaxUint256);
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  console.log("status", rc.status);
})();