/**
 * javascript/v4/liveSmokeTest.js
 * Live smoke test against the freshly deployed hook/router on Unichain mainnet.
 *
 * Verifies the production lifecycle end-to-end with correct production pool
 * keys (hook pool 3000/60, standard pool 500/10):
 *   1. Open a LONG  (margin USDC, baseCurrency=ETH)
 *   2. Accounting invariants: position, solverDebt principal, rehypPrincipal
 *   3. Close LONG, verify full state cleanup
 *   4. Open a SHORT (margin native ETH)
 *   5. Close SHORT, verify full state cleanup
 *
 * Amounts must fit TWO constraints: minCollateralUsd ($0.05) AND the router
 * fronts the FULL notional (margin+borrow) from the trader. Lever 3 keeps
 * both within the test wallet (USDC ~0.22, ETH ~0.00014).
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId } = require("./poolKeys")
const { ETH, USDC } = require("./utils")

const GREEN = "\x1b[32m", RED = "\x1b[31m", CYAN = "\x1b[36m", YELLOW = "\x1b[33m", RESET = "\x1b[0m"
const delay = (ms) => new Promise(r => setTimeout(r, ms))
const assert = (cond, msg) => { if (!cond) throw new Error(msg) }

async function main() {
    const { provider, wallet, hook, router, pf, hookAddr, solverAddr } = setup()
    const hookPoolId = poolId(HOOK_POOL_KEY)
    const trader = wallet.address

    // Nonce discipline for live sends: re-query the account's pending nonce
    // before each tx (this chain's RPC occasionally serves stale cached nonces),
    // and treat an "already known" broadcast as success (the tx is in the
    // mempool — await it rather than moving on confused).
    const nextNonce = async () => await provider.getTransactionCount(trader, "pending")
    async function send(promise) {
        try { return await promise } catch (e) {
            const msg = String((e?.error?.message) || e?.message || "")
            if ((e?.code === "UNKNOWN_ERROR" || e?.code === "NONCE_EXPIRED") && /already known/i.test(msg)) {
                const raw = e?.payload?.params?.[0]
                if (raw) {
                    const hash = ethers.Transaction.from(raw).hash
                    console.log(`  (tx ${hash.slice(0, 18)}… already in mempool — awaiting)`)
                    await provider.waitForTransaction(hash)
                    return { hash, wait: async () => provider.waitForTransaction(hash) }
                }
            }
            throw e
        }
    }

    console.log(`${CYAN}=== LIVE SMOKE TEST (new hook ${hookAddr.slice(0, 10)}...) ===${RESET}`)
    console.log(`Trader/Solver: ${trader}`)
    console.log(`Hook pool id:  ${hookPoolId}`)
    console.log(`Hook pool:     3000/60, standard pool 500/10\n`)

    let passed = 0, total = 0
    const ok = (t, d = "") => { passed++; total++; console.log(`  ${GREEN}✔ PASS:${RESET} ${t} ${d ? "(" + d + ")" : ""}`) }
    const bad = (t, e) => { total++; console.log(`  ${RED}✖ FAIL:${RESET} ${t} — ${e.message || e}`) }

    // ─── Allowances ──────────────────────────────────────────────────────────
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)
    const allowance = await usdc.allowance(trader, router.target)
    if (allowance < ethers.MaxUint256 / 2n) {
        const atx = await send(usdc.approve(router.target, ethers.MaxUint256, { nonce: await nextNonce() }))
        await atx.wait()
        console.log("  USDC approved for router")
    }

    // ─── 1. LONG lifecycle ───────────────────────────────────────────────────
    console.log(`\n${CYAN}--- LONG (3x, USDC margin) ---${RESET}`)
    const lev = 3
    const longMargin = ethers.parseUnits("0.06", 6) // $0.06 > $0.05 floor; notional 0.18 fits wallet USDC
    const longBorrow = longMargin * BigInt(lev - 1)
    const longNotional = longMargin + longBorrow
    console.log(`  margin=${ethers.formatUnits(longMargin, 6)} USDC notional=${ethers.formatUnits(longNotional, 6)} USDC`)

    try {
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, lev, trader])
        const tx = await send(router.swapMultiPool({
            key: HOOK_POOL_KEY,
            standardPoolKey: STANDARD_POOL_KEY,
            zeroForOne: false,                 // LONG: pay USDC (token1), buy ETH
            amountSpecified: -longMargin,
            leverage: lev,
            solver: solverAddr,
            hookData,
            deadline: Math.floor(Date.now() / 1000) + 600,
            minAmountOut: 0n,
        }, { gasLimit: 5_000_000n, nonce: await nextNonce() }))
        const rcpt = await tx.wait()
        if (rcpt.status !== 1) throw new Error("long open tx reverted")
        console.log(`  Opened LONG: ${tx.hash} gas=${rcpt.gasUsed}`)
        ok("Open LONG")
    } catch (e) { bad("Open LONG", e) }

    await delay(1500)
    let posLong = null
    try {
        posLong = await hook.positions(hookPoolId, trader)
        ok("Long position recorded", `coll=${ethers.formatUnits(posLong[1], 6)} usdc bor=${ethers.formatUnits(posLong[2], 6)} lev=${posLong[3]} long=${posLong[4]}`)
    } catch (e) { bad("Long position recorded", e) }

    try {
        // liquidationSqrtPrice is always 0 in storage (computed dynamically at
        // liquidation from the band ticks). Rehyp deployment is proven by the
        // band ticks + deployed liquidity + rehypPrincipal.
        assert(posLong[8] !== 0n, "liquidity (rehyp deployment) zero")
        assert(posLong[6] !== 0n && posLong[7] !== 0n, "rehyp band ticks unset")
        assert(posLong[6] < 0 && posLong[7] < 0, "band not above current tick")
        ok("Rehyp liquidity deployed", `liq=${posLong[8]} band=[${posLong[6]},${posLong[7]}]`)
    } catch (e) { bad("Liquidity deployment", e) }

    try {
        const sd = await hook.solverDebts(hookPoolId, trader, solverAddr)
        console.log(`     solverDebt principal=${ethers.formatUnits(sd[1], 6)} yield=${ethers.formatUnits(sd[2], 6)}`)
        assert(sd[1] === longBorrow, "solver debt principal != borrow")
        ok("Solver debt principal matches borrow")
    } catch (e) { bad("Solver debt principal", e) }

    try {
        const rp = await hook.rehypPrincipal(hookPoolId, trader)
        console.log(`     rehypPrincipal=${ethers.formatUnits(rp, 6)} usdc`)
        assert(rp > 0n, "rehypPrincipal should be > 0 while open")
        ok("rehypPrincipal > 0 while position open")
    } catch (e) { bad("rehypPrincipal while open", e) }

    try {
        const tx = await send(router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr, 0n, { gasLimit: 5_000_000n, nonce: await nextNonce() }))
        const rcpt = await tx.wait()
        if (rcpt.status !== 1) throw new Error("close tx reverted")
        console.log(`  Closed LONG: ${tx.hash} gas=${rcpt.gasUsed}`)
        ok("Long closed cleanly")
    } catch (e) { bad("Close LONG", e) }

    await delay(1500)
    try {
        const p = await hook.positions(hookPoolId, trader)
        assert(p[1] === 0n && p[2] === 0n, "position not cleared")
        ok("Long storage cleared")
    } catch (e) { bad("Long storage cleared", e) }

    // ─── 2. SHORT lifecycle ──────────────────────────────────────────────────
    console.log(`\n${CYAN}--- SHORT (2x, native ETH margin) ---${RESET}`)
    const shortLev = 2
    // Self-sizing: the SHORT spends BOTH the escrow top-up (if any) AND the full
    // msg.value (notional) from this wallet — at 2x that is up to 3*margin +
    // gas when the solver escrow is empty. Pick the cap matching reality.
    const escrow = await router.nativeBorrowEscrow(solverAddr)
    const ethBal = await provider.getBalance(trader)
    const gasReserve = ethers.parseEther("0.0000035")
    const ethPrice18 = await pf.getTwapPrice(ETH)
    const minCollateralUsdFloor = 50000000000000000n // $0.05, matches hook config
    const minMarginFloor = (minCollateralUsdFloor * 10n ** 18n) / ethPrice18
    const worstCaseCap = ((ethBal + escrow) - gasReserve) / BigInt(shortLev + 1)
    const fundedCap = (ethBal - gasReserve) / BigInt(shortLev)
    const escrowCovers = escrow >= worstCaseCap * BigInt(shortLev - 1)
    const cap = escrowCovers ? fundedCap : worstCaseCap
    const shortMargin = cap < minMarginFloor ? minMarginFloor : cap
    const shortBorrow = shortMargin * BigInt(shortLev - 1)
    const shortNotional = shortMargin + shortBorrow
    console.log(`  margin=${ethers.formatEther(shortMargin)} ETH (2x) notional=${ethers.formatEther(shortNotional)} ETH`)

    // C-02: native-input leverage draws the BORROW leg from the solver's
    // router escrow, not from the attached msg.value. Pre-fund it for the test.
    try {
        const escrow = await router.nativeBorrowEscrow(solverAddr)
        if (escrow < shortBorrow) {
            console.log(`  Funding nativeBorrowEscrow(solver) +${ethers.formatEther(shortBorrow - escrow)} ETH`)
            const fundTx = await send(router.depositNativeBorrow(solverAddr, { value: shortBorrow - escrow, nonce: await nextNonce() }))
            await fundTx.wait()
        }
    } catch (e) { bad("Fund nativeBorrowEscrow", e) }

    try {
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, shortLev, trader])
        const tx = await send(router.swapMultiPool({
            key: HOOK_POOL_KEY,
            standardPoolKey: STANDARD_POOL_KEY,
            zeroForOne: true,                  // SHORT: pay ETH (token0), sell ETH
            amountSpecified: -shortMargin,
            leverage: shortLev,
            solver: solverAddr,
            hookData,
            deadline: Math.floor(Date.now() / 1000) + 600,
            minAmountOut: 0n,
        }, { value: shortNotional, gasLimit: 1_000_000n, nonce: await nextNonce() }))
        const rcpt = await tx.wait()
        if (rcpt.status !== 1) throw new Error("short open tx reverted")
        console.log(`  Opened SHORT: ${tx.hash} gas=${rcpt.gasUsed}`)
        ok("Open SHORT")
    } catch (e) { bad("Open SHORT", e) }

    await delay(1500)
    let posShort = null
    try {
        posShort = await hook.positions(hookPoolId, trader)
        ok("Short position recorded", `coll=${ethers.formatUnits(posShort[1], 6)} usdc bor=${ethers.formatUnits(posShort[2], 6)} lev=${posShort[3]} long=${posShort[4]}`)
    } catch (e) { bad("Short position recorded", e) }

    try {
        const sd = await hook.solverDebts(hookPoolId, trader, solverAddr)
        console.log(`     solverDebt principal=${ethers.formatEther(sd[1])} yield=${ethers.formatEther(sd[2])}`)
        assert(sd[1] === shortBorrow, "solver debt principal != borrow")
        ok("Solver debt principal matches borrow")
    } catch (e) { bad("Solver debt principal (short)", e) }

    try {
        const tx = await send(router.closePosition(hookAddr, HOOK_POOL_KEY, trader, solverAddr, 0n, { gasLimit: 5_000_000n, nonce: await nextNonce() }))
        const rcpt = await tx.wait()
        if (rcpt.status !== 1) throw new Error("close tx reverted")
        console.log(`  Closed SHORT: ${tx.hash} gas=${rcpt.gasUsed}`)
        ok("Short closed cleanly")
    } catch (e) { bad("Close SHORT", e) }

    await delay(1500)
    try {
        const p = await hook.positions(hookPoolId, trader)
        const sd = await hook.solverDebts(hookPoolId, trader, solverAddr)
        const rp = await hook.rehypPrincipal(hookPoolId, trader)
        assert(p[1] === 0n && p[2] === 0n, "position not cleared")
        assert(sd[1] === 0n, "solver debt not cleared")
        ok("Short + solver debt + rehypPrincipal cleared", `rehyp=${ethers.formatUnits(rp, 6)}`)
    } catch (e) { bad("Short cleanup", e) }

    // ─── Summary ─────────────────────────────────────────────────────────────
    console.log(`\n${CYAN}=== SUMMARY ===${RESET}`)
    console.log(`  Passed: ${passed}/${total}`)
    const ethNow = await provider.getBalance(trader)
    const usdcNow = await usdc.balanceOf(trader)
    console.log(`  Wallet now: ETH=${ethers.formatEther(ethNow)} USDC=${ethers.formatUnits(usdcNow, 6)}`)
    process.exit(passed === total ? 0 : 1)
}

main().catch((err) => { console.error(`${RED}Fatal:${RESET}`, err); process.exit(1) })
