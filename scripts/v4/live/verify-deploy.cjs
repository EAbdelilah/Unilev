// Post-deploy verification of the Base full-stack redeploy (HEAD).
// Note: the hook's fallback only delegates a strict allow-list of selectors
// (EswapMarginHook.sol L1541), so logic-owned getters such as manager() must be
// read from the logic contracts directly, and hookLogic2 has no getter at all
// (it is a private storage slot) -> taken from the broadcast ctor args.
const { ethers } = require("ethers")

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org"

const A = {
    PriceFeed: "0x91d75C7f750510C04516fC4dcEB5737E5B170c02",
    UsdcTwapFeed: "0xFCaBcc24bB71b42F8ACa94d187174bcfc05c5792",
    EswapMarginLib: "0x3A6F97E9ec31f83Da800c6617695C62aD89656c7",
    HookLogic: "0xDc005F5baAd9e1Ea4E9d8FD1dacfeEA20fcbbce4",
    HookLogic2: "0x3813583344BA7FFa07FBaC53A9232276e5c52a7D",
    HookLogic3: "0x4B400Dc2cC807Df4abF98C021d758c02A43b79a3",
    Hook: "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8",
    Router: "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
    RouterExt: "0x907CdA8c588c9C859A6fB4F105593a64599741CB",
    LiquidationKeeper: "0xe755c37CFC66873f563128DC4aF1D5f27Aa90B2F",
    LeverageAdapter: "0xC622558e9145dbe0Bc37Db5311e70f3F9Fa8cc48",
    LeverageQuoter: "0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5",
    CoWSettlement: "0x7341859C0D7e039118b3f85F341583EBCDB8c960",
    Settlement: "0x6F347acB3bD901731e192d482b7a40c50f30FCa1",
    UniswapXSettlement: "0x8cB966a5102444BbeD5A222AcE1b88d0421b0cB2",
    OneInchFusionSettlement: "0x587f01dE3c42eB5E6a9DBA7a3026719F6F95FBbb",
}
const POOL_MANAGER = "0x498581fF718922c3f8e6A244956aF099B2652b2b"
const WETH = "0x4200000000000000000000000000000000000006"
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
const DEPLOYER = "0x518634753C61342298c3E04326056b3Ce596a566"

const HOOK_ABI = [
    "function owner() view returns (address)",
    "function router() view returns (address)",
    "function priceFeed() view returns (address)",
    "function hookLogic() view returns (address)",
    "function minCollateralUsd() view returns (uint256)",
    "function liquidatorIncentiveBps() view returns (uint256)",
    "function bandConsumptionTriggerBps() view returns (uint256)",
    "function maxSingleOIBps() view returns (uint256)",
    "function maxTotalOIBps() view returns (uint256)",
    "function oiCapTvlFloorUsd() view returns (uint256)",
    "function requireTwapOracle() view returns (bool)",
    "function requireStandardPoolKey() view returns (bool)",
    "function treasury() view returns (address)",
    "function emergencyPaused() view returns (bool)",
]
const ROUTER_ABI = [
    "function owner() view returns (address)",
    "function routerExt() view returns (address)",
    "function executorWhitelist(address) view returns (bool)",
    "function allowedAggregators(address) view returns (bool)",
    "function settlementWhitelist(address) view returns (bool)",
    "function registeredSolvers(address) view returns (bool)",
]
const LOGIC_ABI = ["function manager() view returns (address)"]
const FEED_ABI = ["function feedDecimals(address) view returns (uint8)"]

let fails = 0
const ok = (label, cond, detail = "") => {
    if (!cond) fails++
    console.log(`  ${cond ? "OK  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`)
}
const eq = (label, got, want) => ok(label, String(got).toLowerCase() === String(want).toLowerCase(), `${got}`)

;(async () => {
    const p = new ethers.JsonRpcProvider(RPC)

    console.log("== 1. code presence (all 16) ==")
    for (const [n, a] of Object.entries(A)) {
        const size = ((await p.getCode(a)).length - 2) / 2
        ok(`${n.padEnd(24)} ${a}`, size > 0, `${size} B`)
    }

    console.log("\n== 2. hook wiring ==")
    const hook = new ethers.Contract(A.Hook, HOOK_ABI, p)
    eq("owner", await hook.owner(), DEPLOYER)
    eq("router", await hook.router(), A.Router)
    eq("priceFeed", await hook.priceFeed(), A.PriceFeed)
    eq("hookLogic", await hook.hookLogic(), A.HookLogic)
    eq("treasury", await hook.treasury(), DEPLOYER)
    eq("requireTwapOracle", await hook.requireTwapOracle(), true)
    eq("emergencyPaused", await hook.emergencyPaused(), false)
    console.log(`       minCollateralUsd        ${(await hook.minCollateralUsd()).toString()}`)
    console.log(`       liquidatorIncentiveBps  ${(await hook.liquidatorIncentiveBps()).toString()}`)
    console.log(`       bandConsumptionTrigger  ${(await hook.bandConsumptionTriggerBps()).toString()}`)
    console.log(`       maxSingle/maxTotalOI    ${(await hook.maxSingleOIBps()).toString()} / ${(await hook.maxTotalOIBps()).toString()}`)

    console.log("\n== 3. logic manager() (read from logic, not via hook) ==")
    const l1 = new ethers.Contract(A.HookLogic, LOGIC_ABI, p)
    const l2 = new ethers.Contract(A.HookLogic2, LOGIC_ABI, p)
    eq("logic1.manager", await l1.manager(), POOL_MANAGER)
    eq("logic2.manager", await l2.manager(), POOL_MANAGER)

    console.log("\n== 4. hook ctor args (from broadcast record) ==")
    // `broadcast/` is gitignored; fall back to the committed snapshot so this
    // verifier still runs from a fresh clone.
    let txs
    try {
        txs = require("../../../broadcast/RedeployBaseFull.s.sol/8453/run-latest.json").transactions
    } catch {
        txs = require("./proofs/redeploy-8453-2026-11-11.json").phase3.transactions
    }
    const hookTx = txs.find((t) => t.contractName === "EswapMarginHook")
    ok("hook creation tx found", !!hookTx)
    const [cMgr, cFeed, cL1, cL2, cOwner] = hookTx.arguments
    eq("ctor.manager", cMgr, POOL_MANAGER)
    eq("ctor.priceFeed", cFeed, A.PriceFeed)
    eq("ctor.hookLogic", cL1, A.HookLogic)
    eq("ctor.hookLogic2", cL2, A.HookLogic2)
    eq("ctor.owner", cOwner, DEPLOYER)
    ok("hook address matches mined salt", hookTx.contractAddress.toLowerCase() === A.Hook.toLowerCase())

    console.log("\n== 5. router wiring ==")
    const r = new ethers.Contract(A.Router, ROUTER_ABI, p)
    eq("owner", await r.owner(), DEPLOYER)
    eq("routerExt", await r.routerExt(), A.RouterExt)
    // executors: only the adapter + RouterExt (matches test/v4 setUp)
    eq("executorWhitelist adapter", await r.executorWhitelist(A.LeverageAdapter), true)
    eq("executorWhitelist routerExt", await r.executorWhitelist(A.RouterExt), true)
    eq("executorWhitelist deployer(unexpected)", await r.executorWhitelist(DEPLOYER), false)
    const AGG = {
        "0x AllowanceHolder": "0x0000000000001fF3684f28c67538d4D072C22734",
        Enso: "0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf",
        "ParaSwap V6.2": "0x6A000F20005980200259B80c5102003040001068",
        "ParaSwap V5": "0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52",
        Kyber: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
        "1inch V6": "0x111111125421cA6dc452d289314280a0f8842A65",
        "LI.FI": "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        "Bungee/Socket": "0x50c4E75a512F2A14A7b304787Adf79C4531A5909",
    }
    for (const [n, a] of Object.entries(AGG)) eq(`allowedAggregators ${n}`, await r.allowedAggregators(a), true)
    eq("settlementWhitelist CoW", await r.settlementWhitelist(A.CoWSettlement), true)
    eq("registeredSolvers solver", await r.registeredSolvers("0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037"), true)

    console.log("\n== 6. partner ABI selectors present in router bytecode ==")
    const code = await p.getCode(A.Router)
    const abi = require("../../../out/EswapRouter.sol/EswapRouter.json").abi
    const iface = new ethers.Interface(abi)
    for (const fn of ["swapFor", "swapMultiPoolFor"]) {
        const f = iface.getFunction(fn)
        ok(`${fn} exists in ABI`, !!f)
        if (!f) continue
        const sel = f.selector.slice(2).toLowerCase()
        ok(`${fn} selector ${f.selector} in bytecode`, code.toLowerCase().includes(sel))
        console.log(`       ${fn}(${f.inputs.map((i) => i.type).join(",")})`)
    }

    console.log("\n== 7. price feed ==")
    const f = new ethers.Contract(A.PriceFeed, FEED_ABI, p)
    eq("feedDecimals(WETH) chainlink USD = 8", await f.feedDecimals(WETH), 8)
    eq("feedDecimals(USDC) usdc twap = 18", await f.feedDecimals(USDC), 18)

    console.log("\n== 8. deploy economics ==")
    const bal = await p.getBalance(DEPLOYER)
    const nonce = await p.getTransactionCount(DEPLOYER)
    console.log(`  nonce            ${nonce} (started at 294 -> ${nonce - 294} txs)`)
    console.log(`  balance          ${ethers.formatEther(bal)}`)

    console.log(`\n${fails === 0 ? "ALL CHECKS PASSED" : fails + " CHECK(S) FAILED"}`)
    process.exit(fails === 0 ? 0 : 1)
})()
