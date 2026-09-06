/**
 * javascript/v4/verifyRehypBothDirs.js
 * Deterministic fork test proving rehypothecation (deployCollateral band LP)
 * works for BOTH LONG and SHORT concurrently on the Unichain fork.
 *
 * Fork prerequisites (run before this script):
 *   1. anvil --fork-url $UNICHAIN_RPC_URL --fork-block-number 57882463 --chain-id 130 --port 8545
 *   2. forge script scripts/v4/DeployMockFeed.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *   3. cast send <PRICEFEED> "setPriceFeed(address,address,uint8)" 0x4200..06 <MOCK> 18
 *
 * Phases:
 *   A. LONG  (trader A = solver EOA, zeroForOne=false, USDC margin)   → rehyp in ETH (currency0)
 *   B. SHORT (trader B = anvil #1,    zeroForOne=true,  ETH margin)   → rehyp in USDC (currency1)
 *   C. Both bands live simultaneously; geometry + principal checks.
 *   D. Close LONG  → band removed, rehypPrincipal A → 0.
 *   E. Close SHORT → band removed, rehypPrincipal B → 0.
 */
const { ethers } = require("ethers")
const { setup, loadAbi, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId: computePoolId } = require("./poolKeys")

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", RESET = "\x1b[0m"
const BAND_SPAN = 600                // 10 * hook pool tickSpacing (60)
const TRADER_B = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
const TRADER_B_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

let failures = []
function check(name, cond, extra = "") {
    if (cond) console.log(`  ${GREEN}PASS${RESET}  ${name}`)
    else { failures.push(name); console.log(`  ${RED}FAIL${RESET}  ${name} ${extra}`) }
}

async function waitReceipt(provider, hash, ms = 120000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        const r = await provider.getTransactionReceipt(hash)
        if (r) return r
        await new Promise(res => setTimeout(res, 1500))
    }
    return null
}

async function main() {
    const { provider, wallet, hook, router, hookAddr, solverAddr } = setup()
    const traderA = wallet.address
    const traderB = new ethers.Wallet(TRADER_B_PK, provider)
    if (traderB.address.toLowerCase() !== TRADER_B.toLowerCase()) throw new Error("trader B key mismatch")
    const poolId = computePoolId(HOOK_POOL_KEY)
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)

    const printPos = (label, p, rehyp, collLabel, collDec, debtLabel, debtDec) => {
        console.log(`\n  ${YELLOW}${label}${RESET}`)
        console.log(`    trader      = ${p[0]}`)
        console.log(`    collateral  = ${ethers.formatUnits(p[1].toString(), collDec)} ${collLabel}`)
        console.log(`    borrow      = ${ethers.formatUnits(p[2].toString(), debtDec)} ${debtLabel}`)
        console.log(`    leverage    = ${p[3].toString()}   isLong=${p[4]}`)
        console.log(`    band ticks  = [${p[6].toString()}, ${p[7].toString()}]  liquidity=${p[8].toString()}`)
        console.log(`    rehypPrincipal = ${rehyp.toString()} (${ethers.formatUnits(rehyp.toString(), collDec)} ${collLabel})  -> ${rehyp > 0n ? GREEN + "DEPLOYED" + RESET : RED + "SKIPPED" + RESET}`)
    }

    // ── Phase A: LONG by trader A ────────────────────────────────────────────
    console.log(`\n${"═".repeat(64)}`)
    console.log(` PHASE A — LONG ETH (trader A ${traderA})  margin $0.06 USDC @ 3x`)
    console.log(`${"═".repeat(64)}`)
    {
        const existing = await hook.positions(poolId, traderA)
        if (existing.collateralAmount === 0n || existing[1] === 0n) {
            const margin = ethers.parseUnits("0.06", 6)
            const al = await usdc.allowance(traderA, router.target)
            if (al < margin * 3n) { await (await usdc.approve(router.target, ethers.MaxUint256)).wait() }
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, 3, traderA])
            const tx = await router.swapMultiPool({
                key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
                zeroForOne: false, amountSpecified: -margin, leverage: 3,
                solver: solverAddr || traderA, hookData,
            }, { gasLimit: 5_000_000n })
            const rc = (await waitReceipt(provider, tx.hash)) || { hash: tx.hash, gasUsed: "?", status: 0 }
            console.log(`  OPENED tx=${tx.hash} gas=${rc.gasUsed} status=${rc.status}`)
        } else {
            console.log(`  LONG already open — reusing existing (idempotent re-run)`)
        }

        const pA = await hook.positions(poolId, traderA)
        const rA = await hook.rehypPrincipal(poolId, traderA)
        printPos("LONG position (collateral currency = ETH)", pA, rA, "ETH", 18, "USDC", 6)

        check("LONG isLong=true", pA[4] === true)
        check("LONG rehyp deployed (ETH principal > 0)", rA > 0n)
        check("LONG band liquidity > 0", pA[8] > 0n)
        check("LONG band width == " + BAND_SPAN, pA[7] - pA[6] === BigInt(BAND_SPAN))
        check("LONG band on 60-tick grid", pA[6] % 60n === 0n && pA[7] % 60n === 0n)
        globalThis.__pA = pA; globalThis.__rA = rA
    }

    // ── Phase B: SHORT by trader B ───────────────────────────────────────────
    console.log(`\n${"═".repeat(64)}`)
    console.log(` PHASE B — SHORT ETH (trader B ${traderB.address})  margin 0.002 ETH @ 3x`)
    console.log(`${"═".repeat(64)}`)
    let pB, rB
    {
        const existing = await hook.positions(poolId, traderB.address)
        if (existing.collateralAmount === 0n || existing[1] === 0n) {
            const margin = ethers.parseEther("0.002")
            const notional = margin * 3n
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, 3, traderB.address])
            const routerB = router.connect(traderB)
            const tx = await routerB.swapMultiPool({
                key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
                zeroForOne: true, amountSpecified: -margin, leverage: 3,
                solver: solverAddr || traderA, hookData,
            }, { value: notional, gasLimit: 5_000_000n })
            const rc = (await waitReceipt(provider, tx.hash)) || { hash: tx.hash, gasUsed: "?", status: 0 }
            console.log(`  OPENED tx=${tx.hash} gas=${rc.gasUsed} status=${rc.status}`)
        } else {
            console.log(`  SHORT already open — reusing existing (idempotent re-run)`)
        }

        pB = await hook.positions(poolId, traderB.address)
        rB = await hook.rehypPrincipal(poolId, traderB.address)
        printPos("SHORT position (collateral currency = USDC)", pB, rB, "USDC", 6, "ETH", 18)

        check("SHORT isLong=false", pB[4] === false)
        check("SHORT rehyp deployed (USDC principal > 0)", rB > 0n)
        check("SHORT band liquidity > 0", pB[8] > 0n)
        check("SHORT band width == " + BAND_SPAN, pB[7] - pB[6] === BigInt(BAND_SPAN))
        check("SHORT band on 60-tick grid", pB[6] % 60n === 0n && pB[7] % 60n === 0n)
    }

    // ── Phase C: both live + geometry ────────────────────────────────────────
    console.log(`\n${"═".repeat(64)}`)
    console.log(` PHASE C — coexistence + band geometry + principal currency`)
    console.log(` ${YELLOW}note:${RESET} PoolManager view accessors (getSlot0/getLiquidity) are not exposed by`)
    console.log(`       this v4 fork iteration, so geometry is proven from position data.`)
    console.log(`${"═".repeat(64)}`)
    const pA = globalThis.__pA, rA = globalThis.__rA
    {
        check("both positions open simultaneously", pA[0] !== ethers.ZeroAddress && pB[0] !== ethers.ZeroAddress)
        // _deploymentTicks: LONG(isCurrency0) → [ceilGrid, ceilGrid+600],
        // SHORT(isCurrency1) → [floorGrid-600, floorGrid]; ceilGrid ≥ floorGrid always.
        check("LONG lower ≥ SHORT upper (LONG above, SHORT below)", pA[6] >= pB[7], `(${pA[6]} vs ${pB[7]})`)
        // Principal currency proof: the rehyped principal must sit at ≈90% of the
        // position's OWN collateral (10% kept free as the `capped*9/10` cushion).
        // If the code had mixed currencies0/1 for a direction, the ratio would be ~0
        // (wrong token has no claim backing) → these two checks prove directionality.
        const longRatio = Number(rA) / Number(pA[1])
        const shortRatio = Number(rB) / Number(pB[1])
        check("LONG  principal/collateral ∈ (0.85, 0.95)", longRatio > 0.85 && longRatio < 0.95,
            `(${longRatio.toFixed(4)})`)
        check("SHORT principal/collateral ∈ (0.85, 0.95)", shortRatio > 0.85 && shortRatio < 0.95,
            `(${shortRatio.toFixed(4)})`)
        console.log(`  LONG  principal ${ethers.formatEther(rA)} ETH   → band (${pA[6]},${pA[7]})  liquidity=${pA[8]}`)
        console.log(`  SHORT principal ${ethers.formatUnits(rB, 6)} USDC → band (${pB[6]},${pB[7]})  liq=${pB[8]}`)
        // Sum of both deployed band liquidities is what the LP venue holds from the protocol
        check("band liquidity LONG + SHORT ≥ each individually (qty consistency)", pA[8] > 0n && pB[8] > 0n)
    }

    // ── Phase D: close LONG ──────────────────────────────────────────────────
    console.log(`\n${"═".repeat(64)}`)
    console.log(` PHASE D — close LONG (trader A)`)
    console.log(`${"═".repeat(64)}`)
    {
        const tx = await router.closePosition(hookAddr, HOOK_POOL_KEY, traderA, solverAddr || traderA, 0n,
            { gasLimit: 5_000_000n })
        const rc = (await waitReceipt(provider, tx.hash)) || { hash: tx.hash, gasUsed: "?", status: 0 }
        console.log(`  CLOSED tx=${tx.hash} gas=${rc.gasUsed} status=${rc.status}`)
        const pos = await hook.positions(poolId, traderA)
        const rehyp = await hook.rehypPrincipal(poolId, traderA)
        check("LONG position cleared after close", pos[0] === ethers.ZeroAddress)
        check("LONG rehypPrincipal zeroed after close", rehyp === 0n)
    }

    // ── Phase E: close SHORT ─────────────────────────────────────────────────
    console.log(`\n${"═".repeat(64)}`)
    console.log(` PHASE E — close SHORT (trader B, must be msg.sender)`)
    console.log(`${"═".repeat(64)}`)
    {
        const routerB = router.connect(traderB)
        const tx = await routerB.closePosition(hookAddr, HOOK_POOL_KEY, traderB.address, solverAddr || traderA, 0n,
            { gasLimit: 5_000_000n })
        const rc = (await waitReceipt(provider, tx.hash)) || { hash: tx.hash, gasUsed: "?", status: 0 }
        console.log(`  CLOSED tx=${tx.hash} gas=${rc.gasUsed} status=${rc.status}`)
        const pos = await hook.positions(poolId, traderB.address)
        const rehyp = await hook.rehypPrincipal(poolId, traderB.address)
        check("SHORT position cleared after close", pos[0] === ethers.ZeroAddress)
        check("SHORT rehypPrincipal zeroed after close", rehyp === 0n)
    }

    console.log(`\n${"═".repeat(64)}`)
    if (failures.length === 0) {
        console.log(` ${GREEN}ALL CHECKS PASSED — rehypothecation verified for LONG and SHORT${RESET}`)
    } else {
        console.log(` ${RED}${failures.length} CHECK(S) FAILED:${RESET}`)
        failures.forEach(f => console.log(`   ✗ ${f}`))
        process.exitCode = 1
    }
    console.log(`${"═".repeat(64)}`)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })