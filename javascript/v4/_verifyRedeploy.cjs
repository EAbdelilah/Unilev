const { ethers } = require("ethers")
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })

const HOOK = "0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8"
const ROUTER = "0x4c14D923E9A9f64Da6684b77E07B33c76D0B3d60"
const PRICEFEED = "0xc245def5317DbcB34e9F153eb3E0388bbc0e69F5"
const SOLVER = "0x518634753C61342298c3E04326056b3Ce596a566"
const WETH = "0x4200000000000000000000000000000000000006"
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6"

const provider = new ethers.JsonRpcProvider(process.env.UNICHAIN_RPC_URL)

const hookAbi = [
  "function isAuthorizedPool(bytes32) view returns (bool)",
  "function baseCurrency(bytes32) view returns (address)",
  "function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)",
  "function minCollateralUsd() view returns (uint256)",
  "function oiCapTvlFloorUsd() view returns (uint256)",
  "function maxSingleOIBps() view returns (uint256)",
  "function maxTotalOIBps() view returns (uint256)",
  "function openInterestCapacity() view returns (bool,uint256,uint256,uint256,uint256)",
  "function router() view returns (address)",
  "function owner() view returns (address)",
  "function totalCollateralUSDRunning() view returns (uint256)",
  "function totalOpenInterestUSD() view returns (uint256)",
]
const routerAbi = [
  "function registeredSolvers(address) view returns (bool)",
  "function owner() view returns (address)",
]

async function main() {
  const hook = new ethers.Contract(HOOK, hookAbi, provider)
  const router = new ethers.Contract(ROUTER, routerAbi, provider)

  const poolId = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint24", "int24", "address"],
      [USDC, WETH, 3000, 60, HOOK]
    )
  )
  console.log("poolId:", poolId)
  console.log("hook.owner():", await hook.owner())
  console.log("hook.router():", await hook.router())
  console.log("minCollateralUsd:", (await hook.minCollateralUsd()).toString())
  console.log("isAuthorizedPool:", await hook.isAuthorizedPool(poolId))
  console.log("baseCurrency:", await hook.baseCurrency(poolId))
  console.log("standardPoolKeys:", await hook.standardPoolKeys(poolId))
  console.log("oiCapTvlFloorUsd:", (await hook.oiCapTvlFloorUsd()).toString())
  console.log("maxSingleOIBps:", (await hook.maxSingleOIBps()).toString())
  console.log("maxTotalOIBps:", (await hook.maxTotalOIBps()).toString())
  console.log("openInterestCapacity:", await hook.openInterestCapacity())
  console.log("router.owner():", await router.owner())
  console.log("router.registeredSolvers(SOLVER):", await router.registeredSolvers(SOLVER))
}

main().catch((e) => { console.error(e); process.exit(1) })