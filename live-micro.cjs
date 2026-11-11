require("dotenv").config();
const { ethers } = require("ethers");
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const HOOK = "0xe33A630503c640143126BBF222a82689D49b50c8";
const ROUTER = "0xD3360D67E366Cac21a1c18fC9100B93be79e1437";
const ADAPTER = "0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const SOLVER = "0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037";
const MARGIN = ethers.parseEther("0.00001"); // ~$0.03
const LEVERAGE = 2;
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
async function wait(hash,label){ for(let i=0;i<60;i++){ await sleep(2000); const r=await provider.getTransactionReceipt(hash).catch(()=>null); if(r){ if(r.status===1){console.log("OK",label,"gas",r.gasUsed.toString(),hash);return r;} throw new Error(label+" REVERTED "+hash);} } throw new Error(label+" TIMEOUT "+hash);}
const adapterAbi = ["function owner() view returns (address)","function registerPool(address,address,uint24,tuple(address,address,uint24,int24,address),tuple(address,address,uint24,int24,address))","function exactInputSingleWithLeverage(address,address,uint24,uint8,uint256,uint256,address)","function defaultSolver() view returns (address)"];
const routerAbi = ["function solverWhitelist(address) view returns (bool)","function setSolverWhitelist(address,bool)"];
const erc20Abi = ["function balanceOf(address) view returns (uint256)","function approve(address,uint256) returns (bool)","function transfer(address,uint256) returns (bool)","function allowance(address,address) view returns (uint256)"];
const hookAbi = ["function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)","function closePosition? no"];
(async () => {
  const adapter = new ethers.Contract(ADAPTER, adapterAbi, wallet);
  const router = new ethers.Contract(ROUTER, routerAbi, wallet);
  const weth = new ethers.Contract(WETH, erc20Abi, wallet);
  const hook = new ethers.Contract(HOOK, ["function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)","function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)"], provider);

  // register pool WETH->USDC
  try {
    const tx = await adapter.registerPool(WETH, USDC, 3000, [WETH,USDC,3000,60,HOOK], [WETH,USDC,500,10,ethers.ZeroAddress]);
    await wait(tx.hash, "registerPool");
  } catch(e){ console.log("registerPool err", e.shortMessage||e.message); }

  // fund solver with WETH
  const solverWeth = new ethers.Contract(WETH, erc20Abi, provider);
  const bal = await solverWeth.balanceOf(SOLVER);
  if (bal < MARGIN) {
    const tx = await weth.transfer(SOLVER, MARGIN);
    await wait(tx.hash, "fund solver WETH");
  } else console.log("solver already funded", ethers.formatEther(bal));

  // approve router for recipient? adapter pulls margin from msg.sender? exactInputSingleWithLeverage uses recipient? Let's check signature: (tokenIn,tokenOut,fee,leverage,margin,minOut,recipient). It likely pulls margin from recipient? Actually adapter pulls from recipient? In tests, vm.prank(trader) calls adapter; recipient=trader. So margin from trader (deployer). Approve router from deployer.
  const allowance = await weth.allowance(wallet.address, ROUTER);
  if (allowance < MARGIN) {
    const tx = await weth.approve(ROUTER, ethers.MaxUint256);
    await wait(tx.hash, "approve router");
  }

  // solver approve router
  // cannot sign for solver unless we have key. SOLVER_PRIVATE_KEY available? Use wallet from SOLVER_PRIVATE_KEY
  const solverWallet = new ethers.Wallet(process.env.SOLVER_PRIVATE_KEY, provider);
  const solverWethC = new ethers.Contract(WETH, erc20Abi, solverWallet);
  const sal = await solverWethC.allowance(SOLVER, ROUTER);
  if (sal < MARGIN*2n) {
    const tx = await solverWethC.approve(ROUTER, ethers.MaxUint256);
    await wait(tx.hash, "solver approve router");
  }

  // open
  const minOut = 0;
  const tx = await adapter.exactInputSingleWithLeverage(WETH, USDC, 3000, LEVERAGE, MARGIN, minOut, wallet.address);
  console.log("open tx", tx.hash);
  const rc = await wait(tx.hash, "OPEN");
  const hookId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address","address","uint24","int24","address"], [WETH,USDC,3000,60,HOOK]));
  const pos = await hook.positions(hookId, wallet.address);
  console.log("position:", pos[0], "collateral", pos[1].toString(), "borrowed", pos[2].toString(), "lev", pos[3]);
  const debt = await hook.solverDebts(hookId, wallet.address, SOLVER);
  console.log("solverDebt", debt[0], debt[1].toString());

  // close
  const routerC = new ethers.Contract(ROUTER, ["function closePosition(address,tuple(address,address,uint24,int24,address),address,address,uint256)"], wallet);
  const key = [WETH, USDC, 3000, 60, HOOK];
  const ctx = await routerC.closePosition(HOOK, key, wallet.address, SOLVER, 0);
  console.log("close tx", ctx.hash);
  await wait(ctx.hash, "CLOSE");
  const posAfter = await hook.positions(hookId, wallet.address);
  console.log("after close trader", posAfter[0], "collateral", posAfter[1].toString(), "liq", posAfter[8].toString());
  console.log("LIVE FULL CYCLE SUCCESS");
})();