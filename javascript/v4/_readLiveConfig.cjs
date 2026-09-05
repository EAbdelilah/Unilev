const { ethers } = require("ethers")
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })

const HOOK = process.env.V4_HOOK_ADDRESS
const ROUTER = process.env.V4_ROUTER_ADDRESS
const KEEPER = process.env.V4_KEEPER_ADDRESS
const PRICEFEED = process.env.V4_PRICEFEED_ADDRESS
const SOLVER = process.env.V4_SOLVER_ADDRESS

const WETH = "0x4200000000000000000000000000000000000006"
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6"
const NATIVE = ethers.ZeroAddress

const provider = new ethers.JsonRpcProvider(process.env.UNICHAIN_RPC_URL)

const simpleGet = ["function owner() view returns (address)", "function router() view returns (address)", "function reserveFactor() view returns (uint256)", "function maxPriceSwingBps() view returns (uint160)", "function defaultMaxLeverage() view returns (uint8)", "function requireTwapOracle() view returns (bool)", "function minCollateralUsd() view returns (uint256)", "function tokenDecimals(address) view returns (uint8)", "function isAuthorizedPool(bytes32) view returns (bool)", "function standardPoolKeys(bytes32) view returns (address,address,uint24,int24,address)", "function baseCurrency(bytes32) view returns (address)", "function openInterestCapacity() view returns (bool,uint256,uint256,uint256,uint256)", "function maxSingleOIBps() view returns (uint256)", "function maxTotalOIBps() view returns (uint256)", "function oiCapTvlFloorUsd() view returns (uint256)", "function bandConsumptionTriggerBps() view returns (uint256)", "function insuranceWithdrawalCapBps() view returns (uint256)", "function totalBorrowedByToken(address) view returns (uint256)", "function totalCollateral(address) view returns (uint256)", "function insuranceFund(address) view returns (uint256)", "function protocolFees(address) view returns (uint256)", "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,int24,int24,int24,uint128)"]

const routerSimple = ["function owner() view returns (address)", "function registeredSolvers(address) view returns (bool)"]
const keeperSimple = ["function owner() view returns (address)", "function hook() view returns (address)", "function router() view returns (address)", "function slippageBps() view returns (uint256)"]

function poolId(c0, c1, fee, tick) {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"], [c0, c1, fee, tick, HOOK]))
}
const nativeId = poolId(NATIVE, USDC, 3000, 60)
const oldId = poolId(USDC, WETH, 3000, 60)

async function readAll(addr, abi, label) {
    const c = new ethers.Contract(addr, abi, provider)
    const out = {}
    for (const f of abi) {
        const name = f.match(/function\s+(\w+)/)[1]
        try {
            let args = []
            if (name === "tokenDecimals") args = [WETH]
            if (name.includes("isAuthorizedPool") || name.includes("standardPoolKeys") || name.includes("baseCurrency")) {
                const r = []
                for (const id of [nativeId, oldId]) {
                    try { r.push(id.slice(0, 10) + ": " + JSON.stringify(await c[name](id))) } catch (e) { r.push(id.slice(0, 10) + ": ERR " + e.reason) }
                }
                out[name] = r
                continue
            }
            if (name === "positions") {
                for (const t of [SOLVER, process.env.TINY_TRADER, (await provider.getBalance(WETH) && undefined)]) {
                    if (!t) continue
                    try { out["positions(" + t.slice(0, 10) + ")"] = JSON.stringify(await c[name](nativeId, t)) } catch (e) {}
                }
                continue
            }
            out[name] = JSON.stringify(await c[name](...args))
        } catch (e) {
            out[name] = "ERR " + (e.reason || e.message)
        }
    }
    return out
}

async function main() {
    console.log("=== hook =", HOOK)
    console.log(JSON.stringify(await readAll(HOOK, simpleGet, "hook"), null, 1))
    console.log("=== router =", ROUTER)
    console.log(JSON.stringify(await readAll(ROUTER, routerSimple, "router"), null, 1))
    console.log("=== keeper =", KEEPER)
    console.log(JSON.stringify(await readAll(KEEPER, keeperSimple, "keeper"), null, 1))

    // pool slot0 for init price: deep native-ETH/USDC 500/10
    const realPM = new ethers.Contract("0x1F98400000000000000000000000000000000004",
        ["function slot0(bytes32) view returns (uint160,int24,uint16,uint24,int24,int24)"], provider)
    const deepId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"], [NATIVE, USDC, 500, 10, ethers.ZeroAddress]))
    console.log("=== deep pool slot0 (id=" + deepId.slice(0, 10) + ")")
    try { console.log(JSON.stringify(await realPM.slot0(deepId))) } catch (e) { console.log("ERR " + e.reason) }
    console.log("=== solver addr:", SOLVER)
}
main().catch(e => { console.error(e); process.exit(1) })