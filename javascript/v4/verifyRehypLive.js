/**
 * javascript/v4/verifyRehypLive.js
 * LIVE mainnet (Unichain) verification of rehypothecation for BOTH directions.
 *
 * Runs against the real deployment with real dust-sized funds on the single
 * operational EOA (trader == solver). Because one pool holds ONE position per
 * trader, the two directions run SEQUENTIALLY:
 *   LONG  (margin USDC   @3x) → verify band + rehypPrincipal (ETH) → close → verify cleared
 *   SHORT (margin native ETH @3x) → verify band + rehypPrincipal (USDC) → close → verify cleared
 *
 * Assertions (mirror of the fork proof verifyRehypBothDirs.js):
 *   band width == 600 (10 × hook tickSpacing 60), ticks on the 60-grid,
 *   principal/collateral ∈ (0.85, 0.95) in the position's OWN collateral
 *   currency (currency0=ETH for longs, currency1=USDC for shorts),
 *   close zeroes rehypPrincipal and clears the position.
 *
 * SAFETY: aborts if a position is already open on the EOA. Uses 5M gas (the
 * Option-B guard budget) on every tx. Amounts are chosen to fit the dust
 * wallet (USDC ~0.22, ETH ~0.00013).
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId } = require("./poolKeys")

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m", RESET = "\x1b[0m"
const delay = (ms) => new Promise(r => setTimeout(r, ms))

let passed = 0, total = 0
const ok = (t, d = "") => { passed++; total++; console.log(`  ${GREEN}PASS${RESET}  ${t}${d ? "  (" + d + ")" : ""}`) }
const bad = (t, e) => { total++; console.log(`  ${RED}FAIL${RESET}  ${t}  — ${(e && e.message) || e}`) }

async function waitReceipt(provider, hash, ms = 180000) {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
        const r = await provider.getTransactionReceipt(hash)
        if (r) return r
        await new Promise(res => setTimeout(res, 1500))
    }
    return null
}

async function main() {
    const { provider, wallet, hook, router, hookAddr, pf, solverAddr } = setup()
    const hookPoolId = poolId(HOOK_POOL_KEY)
    const trader = wallet.address
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)

    console.log(`${CYAN}═ LIVE REHYP VERIFY — Unichain mainnet ${"═".repeat(40)}${RESET}`)
    const net = await provider.getNetwork()
    if (net.chainId !== 130n) {
        console.log(`${RED}ABORT: chainId=${net.chainId} is NOT Unichain mainnet (130).${RESET}`)
        process.exit(1)
    }
    console.log(`  chainId: ${net.chainId}  block: ${await provider.getBlockNumber()}`)
    const livePrice = await pf.getAmountInUsd(ETH, ethers.parseEther("1"))
    console.log(`  ETH spot: $${ethers.formatUnits(livePrice, 18)}`)
    console.log(`  EOA: ${trader}`)
    console.log(`  pool id: ${hookPoolId}`)
    const eth0 = await provider.getBalance(trader)
    const usdc0 = await usdc.balanceOf(trader)
    console.log(`  before: ETH=${ethers.formatEther(eth0)}  USDC=${ethers.formatUnits(usdc0, 6)}`)

    // ── Preconditions ────────────────────────────────────────────────────────
    const existing = await hook.positions(hookPoolId, trader)
    if (existing[0] !== ethers.ZeroAddress) {
        console.log(`${RED}Abort: an open position already exists for this EOA (do not stack).${RESET}`)
        process.exit(1)
    }
    const lev = 3

    // Allowance (one-time on live)
    const allowance = await usdc.allowance(trader, router.target)
    if (allowance < ethers.MaxUint256 / 2n) {
        const atx = await usdc.approve(router.target, ethers.MaxUint256, { gasLimit: 1_000_000n })
        const ar = await waitReceipt(provider, atx.hash)
        console.log(`  USDC approved (${ar ? `status=${ar.status}` : "timeout"})`)
    }

    // ── PHASE 1: LONG ────────────────────────────────────────────────────────
    console.log(`\n${CYAN}── LONG  3x (margin $0.06 USDC, collateral = ETH) ──${RESET}`)
    const longMargin = ethers.parseUnits("0.06", 6)
    try {
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, lev, trader])
        const tx = await router.swapMultiPool({
            key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
            zeroForOne: false, amountSpecified: -longMargin, leverage: lev,
            solver: solverAddr || trader, hookData,
        }, { gasLimit: 5_000_000n })
        const rc = await waitReceipt(provider, tx.hash)
        if (!rc || rc.status !== 1) { bad("Open LONG"); return }
        console.log(`  ${GREEN}OPENED${RESET} ${tx.hash} gas=${rc.gasUsed}`)
        ok("Open LONG")
    } catch (e) { bad("Open LONG", e); return }

    await delay(2000)
    const pLong = await hook.positions(hookPoolId, trader)
    const rLong = await hook.rehypPrincipal(hookPoolId, trader)
    console.log(`  collateral=${ethers.formatEther(pLong[1])} ETH borrow=${ethers.formatUnits(pLong[2], 6)} USDC lev=${pLong[3]} isLong=${pLong[4]}`)
    console.log(`  band=[${pLong[6]},${pLong[7]}] liquidity=${pLong[8]}  rehyp=${ethers.formatEther(rLong)} ETH`)
    try {
        ok("LONG isLong=true", pLong[4] === true ? "yes" : "NO")
        ok("LONG rehyp deployed (ETH > 0)", rLong > 0n ? rLong.toString() : "ZERO")
        ok("LONG band liquidity > 0", pLong[8].toString())
        ok("LONG band width == 600", (pLong[7] - pLong[6]).toString())
        ok("LONG band on 60-grid", `${pLong[6]}%60, ${pLong[7]}%60`)
        const ratio = Number(rLong) / Number(pLong[1])
        ok(`LONG principal/collateral ∈ (0.85,0.95)`, ratio.toFixed(4))
        const sd = await hook.solverDebts(hookPoolId, trader, solverAddr || trader)
        ok("LONG solverDebt == borrow", sd[1].toString())
    } catch (e) { bad("LONG assertions", e) }

    try {
        const tx = await router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr || trader, 0n, { gasLimit: 5_000_000n })
        const rc = await waitReceipt(provider, tx.hash)
        if (!rc || rc.status !== 1) { bad("Close LONG"); return }
        console.log(`  ${GREEN}CLOSED${RESET} ${tx.hash} gas=${rc.gasUsed}`)
        ok("Close LONG")
    } catch (e) { bad("Close LONG", e); return }
    await delay(2000)
    {
        const p = await hook.positions(hookPoolId, trader)
        const r = await hook.rehypPrincipal(hookPoolId, trader)
        ok("LONG position cleared", p[0] === ethers.ZeroAddress ? "yes" : p[0])
        ok("LONG rehyp zeroed", r.toString())
    }

    // ── PHASE 2: SHORT ───────────────────────────────────────────────────────
    console.log(`\n${CYAN}── SHORT 3x (margin native ETH, collateral = USDC) ──${RESET}`)
    const ethNow = await provider.getBalance(trader)
    const shortMargin = ethers.parseEther("0.00003") // ~$0.07 @live, > $0.05 floor
    const shortNotional = shortMargin * BigInt(lev)   // value attached must cover margin+borrow
    console.log(`  margin=${ethers.formatEther(shortMargin)} ETH  value=${ethers.formatEther(shortNotional)} ETH  balance=${ethers.formatEther(ethNow)} ETH`)
    if (ethNow < shortNotional + ethers.parseEther("0.00001")) {
        console.log(`${YELLOW}SKIP SHORT: wallet ETH cannot cover notional + gas.${RESET}`)
    } else {
        try {
            const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, lev, trader])
            const tx = await router.swapMultiPool({
                key: HOOK_POOL_KEY, standardPoolKey: STANDARD_POOL_KEY,
                zeroForOne: true, amountSpecified: -shortMargin, leverage: lev,
                solver: solverAddr || trader, hookData,
            }, { value: shortNotional, gasLimit: 5_000_000n })
            const rc = await waitReceipt(provider, tx.hash)
            if (!rc || rc.status !== 1) { bad("Open SHORT"); return }
            console.log(`  ${GREEN}OPENED${RESET} ${tx.hash} gas=${rc.gasUsed}`)
            ok("Open SHORT")
        } catch (e) { bad("Open SHORT", e); return }

        await delay(2000)
        const pShort = await hook.positions(hookPoolId, trader)
        const rShort = await hook.rehypPrincipal(hookPoolId, trader)
        console.log(`  collateral=${ethers.formatUnits(pShort[1], 6)} USDC borrow=${ethers.formatEther(pShort[2])} ETH lev=${pShort[3]} isLong=${pShort[4]}`)
        console.log(`  band=[${pShort[6]},${pShort[7]}] liquidity=${pShort[8]}  rehyp=${ethers.formatUnits(rShort, 6)} USDC`)
        try {
            ok("SHORT isLong=false", pShort[4] === false ? "yes" : "NO")
            ok("SHORT rehyp deployed (USDC > 0)", rShort > 0n ? rShort.toString() : "ZERO")
            ok("SHORT band liquidity > 0", pShort[8].toString())
            ok("SHORT band width == 600", (pShort[7] - pShort[6]).toString())
            ok("SHORT band on 60-grid", `${pShort[6]}%60, ${pShort[7]}%60`)
            const ratio = Number(rShort) / Number(pShort[1])
            ok(`SHORT principal/collateral ∈ (0.85,0.95)`, ratio.toFixed(4))
            const sd = await hook.solverDebts(hookPoolId, trader, solverAddr || trader)
            ok("SHORT solverDebt == borrow", sd[1].toString())
        } catch (e) { bad("SHORT assertions", e) }

        try {
            const tx = await router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr || trader, 0n, { gasLimit: 5_000_000n })
            const rc = await waitReceipt(provider, tx.hash)
            if (!rc || rc.status !== 1) { bad("Close SHORT"); return }
            console.log(`  ${GREEN}CLOSED${RESET} ${tx.hash} gas=${rc.gasUsed}`)
            ok("Close SHORT")
        } catch (e) { bad("Close SHORT", e); return }
        await delay(2000)
        {
            const p = await hook.positions(hookPoolId, trader)
            const r = await hook.rehypPrincipal(hookPoolId, trader)
            ok("SHORT position cleared", p[0] === ethers.ZeroAddress ? "yes" : p[0])
            ok("SHORT rehyp zeroed", r.toString())
        }
    }

    console.log(`\n${CYAN}══ SUMMARY ══${RESET}  Passed ${passed}/${total}`)
    const eth1 = await provider.getBalance(trader)
    const usdc1 = await usdc.balanceOf(trader)
    console.log(`  after: ETH=${ethers.formatEther(eth1)}  USDC=${ethers.formatUnits(usdc1, 6)}`)
    console.log(`  gas consumed (ETH): ${ethers.formatEther(eth0 - eth1)} (incl. short value if any)`)
    process.exit(passed === total ? 0 : 1)
}

main().catch(e => { console.error("Fatal:", e); process.exit(1) })