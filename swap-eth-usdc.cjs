require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const WETH = "0x4200000000000000000000000000000000000006";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481";
const abi = ["function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256)"];
const router = new ethers.Contract(ROUTER, abi, wallet);
(async () => {
  const amountIn = ethers.parseEther("0.00003");
  const params = {
    tokenIn: WETH,
    tokenOut: USDC,
    fee: 500,
    recipient: wallet.address,
    deadline: Math.floor(Date.now()/1000)+300,
    amountIn,
    amountOutMinimum: 0,
    sqrtPriceLimitX96: 0
  };
  const tx = await router.exactInputSingle(params, { value: amountIn });
  console.log("tx", tx.hash);
  const rc = await tx.wait();
  console.log("status", rc.status, "gas", rc.gasUsed.toString());
})();