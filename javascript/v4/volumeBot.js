/**
 * javascript/v4/volumeBot.js
 * Volume Bot — simulates organic trader activity by opening and closing
 * positions at random intervals with variable sizes and directions.
 *
 * Run:
 *   node javascript/v4/volumeBot.js [--dry-run]
 *
 * What it does:
 *   1. Opens long or short positions with random leverage (2-5x)
 *   2. Holds for a random duration, then closes
 *   3. Random intervals between trades (5-30 minutes)
 *   4. Logs all activity with P&L tracking
 *   5. --dry-run flag previews trades without broadcasting
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId: computePoolId } = require("./poolKeys")

const DRY_RUN = process.argv.includes("--dry-run")

// Bounded run: when --cycles N is passed, exit after N complete trades
// (useful for in-session verification vs an unbounded daemon loop).
const cyclesArg = process.argv.find(a => a.startsWith("--cycles="))
const MAX_CYCLES = cyclesArg ? parseInt(cyclesArg.split("=")[1], 10) : Infinity

// ── Configuration ────────────────────────────────────────────────
// Sizes are tiny to fit the dust wallet (0.44 USDC + 0.0002 ETH).
// The bot computes actual trade sizes from live wallet balance so it
// never requests more than the wallet can fund.
const MAX_MARGIN_USD    = 0.10    // $0.10 max margin
const MIN_LEVERAGE      = 2       // 2x – 3x keeps notional small and safe
const MAX_LEVERAGE      = 3
const MIN_HOLD_MS       = 20_000  // 20s – 60s (short for bounded in-session runs)
const MAX_HOLD_MS       = 60_000
const MIN_INTERVAL_MS   = 10_000
const MAX_INTERVAL_MS   = 30_000
// If wallet has no funds to open a LONG, fall back to opening a SHORT
// (or vice versa) instead of stalling forever.
const ALLOW_DIRECTION_FALLBACK = true

const GREEN  = "\x1b[32m"
const CYAN   = "\x1b[36m"
const YELLOW = "\x1b[33m"
const RED    = "\x1b[31m"
const RESET  = "\x1b[0m"

function rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min
}

function randFloat(min, max) {
    return Math.random() * (max - min) + min
}

function fmtUsd(v) { return `$${parseFloat(v).toFixed(4)}` }
function fmtEth(v) { return `${parseFloat(v).toFixed(8)} ETH` }

async function main() {
    const { provider, wallet, hook, router, pf, hookAddr, solverAddr, ETH } = setup()

    // Trader may be a separate wallet from the solver. When TRADER_PK is set,
    // the volume bot signs trades as that account (the borrower), while the
    // solver (PRIVATE_KEY / SOLVER_ADDRESS) remains the separate lender.
    const traderPk = process.env.TRADER_PK
    const trader = traderPk ? new ethers.Wallet(traderPk, provider) : wallet

    const traderRouter = router.connect(trader)
    const usdc = new ethers.Contract(USDC, ERC20_ABI, trader)

    // Nonce/send discipline: re-query the pending nonce before every broadcast
    // and absorb "already known" (the RPC backend set sometimes echoes back a
    // broadcast that already landed in the mempool — that is success, not
    // failure).
    const nextNonce = async () => await provider.getTransactionCount(trader.address, "pending")
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

    const poolKey = HOOK_POOL_KEY
    const standardPoolKey = STANDARD_POOL_KEY
    const poolId = computePoolId(HOOK_POOL_KEY)

    console.log(`\n${"═".repeat(58)}`)
    console.log(`  VOLUME BOT — Eswap V4 Unichain`)
    console.log(`  Trader    : ${trader.address}`)
    console.log(`  Solver    : ${solverAddr}`)
    console.log(`  Mode      : ${DRY_RUN ? "DRY RUN (no txs)" : "LIVE"}`)
    console.log(`  Margin    : ≤ $${MAX_MARGIN_USD}`)
    console.log(`  Leverage  : ${MIN_LEVERAGE}x – ${MAX_LEVERAGE}x`)
    console.log(`  Hold      : ${(MIN_HOLD_MS / 1000).toFixed(0)}–${(MAX_HOLD_MS / 1000).toFixed(0)}s`)
    console.log(`  Interval  : ${(MIN_INTERVAL_MS / 1000).toFixed(0)}–${(MAX_INTERVAL_MS / 1000).toFixed(0)}s`)
    console.log(`${"═".repeat(58)}\n`)

    // Ensure USDC approval
    const allowance = await usdc.allowance(trader.address, router.target)
    const maxNotional = ethers.parseUnits(MAX_MARGIN_USD.toString(), 6) * BigInt(MAX_LEVERAGE)
    if (allowance < maxNotional) {
        console.log(`Approving USDC for max notional (${ethers.formatUnits(maxNotional, 6)} USDC)…`)
        if (!DRY_RUN) {
            const tx = await send(usdc.approve(router.target, ethers.MaxUint256, { nonce: await nextNonce() }))
            await tx.wait()
            console.log(`✅ Approved`)
        } else {
            console.log(`(dry-run: skipped)`)
        }
    }

    // Native-borrow escrow (C-02): leveraged SHORTs pull the borrow leg from the
    // SOLVER's escrow on the router, not from the trader's msg.value. Top the
    // escrow up to cover one session-sized borrow leg, capped by what the
    // wallet can actually spare (never sink more than 30% of ETH into escrow).
    if (solverAddr && !DRY_RUN) {
        const escrow = await router.nativeBorrowEscrow(solverAddr)
        const ethBal = await provider.getBalance(trader.address)
        const escrowTarget = ethers.parseUnits("0.00005", 18) // ~2x borrow on a $0.05 SHORT margin
        if (escrow < escrowTarget) {
            const gap = escrowTarget - escrow
            const cap = (ethBal * 30n) / 100n
            const topUp = gap < cap ? gap : cap
            if (topUp > 0n) {
                console.log(`Toping up solver nativeBorrowEscrow by ${ethers.formatEther(topUp)} ETH…`)
                const tx = await send(router.depositNativeBorrow(solverAddr, { value: topUp, nonce: await nextNonce() }))
                await tx.wait()
            } else {
                console.log(`${YELLOW}(ETH too low to top up escrow — relying on existing escrow / LONG fallback)${RESET}`)
            }
        }
        console.log(`✅ Solver escrow: ${ethers.formatEther(await router.nativeBorrowEscrow(solverAddr))} ETH`)
    }

    let tradeCount = 0
    let cycleNum = 0
    let totalPnl = 0n
    let wins = 0, losses = 0

    while (true) {
        const leverage = rand(MIN_LEVERAGE, MAX_LEVERAGE)

        // ── Read live balances and pick a fundable direction ─────
        const ethBal = await provider.getBalance(trader.address)
        const usdcBal = await usdc.balanceOf(trader.address)

        // Available margin = up to 50% of the relevant token balance,
        // capped at MAX_MARGIN_USD.
        const maxMarginEth = (ethBal * 50n) / 100n
        const maxMarginUsdc = (usdcBal * 50n) / 100n
        const maxMarginUsdCap = ethers.parseUnits(MAX_MARGIN_USD.toString(), 6)

        // Compare in USD: ETH margin is valued through the price feed (not raw
        // ETH count vs dollar — that was off by ~2500x on the short side).
        const ethMarginUsd = Number(ethers.formatUnits(await pf.getAmountInUsd(ETH, maxMarginEth), 18))
        const usdcMarginUsd = Number(ethers.formatUnits(maxMarginUsdc, 6))

        // A LONG needs USDC margin+borrow; a SHORT needs ETH margin+borrow.
        const shortAffordable = ethMarginUsd >= 0.02  // ~$0.02 min
        const longAffordable  = usdcMarginUsd >= 0.02

        let isLong = Math.random() > 0.5
        if (!isLong && !shortAffordable && longAffordable) {
            if (!ALLOW_DIRECTION_FALLBACK) { await new Promise(r => setTimeout(r, MIN_INTERVAL_MS)); continue }
            isLong = true
            console.log(`  ${YELLOW}(ETH too low to short -> falling back to LONG)${RESET}`)
        } else if (isLong && !longAffordable && shortAffordable) {
            if (!ALLOW_DIRECTION_FALLBACK) { await new Promise(r => setTimeout(r, MIN_INTERVAL_MS)); continue }
            isLong = false
            console.log(`  ${YELLOW}(USDC too low to long -> falling back to SHORT)${RESET}`)
        } else if (!longAffordable && !shortAffordable) {
            console.log(`  ${RED}Insufficient funds for both directions. Waiting…${RESET}`)
            await new Promise(r => setTimeout(r, MIN_INTERVAL_MS))
            continue
        }

        // size margin to the affordable cap for the chosen direction
        // LONG margin is in USDC (6-dec), SHORT margin is in ETH (18-dec).
        let marginAmount
        if (isLong) {
            marginAmount = maxMarginUsdc > maxMarginUsdCap ? maxMarginUsdCap : maxMarginUsdc
        } else {
            marginAmount = maxMarginEth
        }

        const borrowAmount = marginAmount * BigInt(leverage - 1)
        const notional = marginAmount + borrowAmount

        tradeCount++
        const tag = `#${tradeCount}`

        console.log(`\n${CYAN}━━━ Trade ${tag} [${new Date().toISOString().slice(11, 19)}] ━━━${RESET}`)
        console.log(`  Direction : ${isLong ? "LONG" : "SHORT"}`)
        console.log(`  Leverage  : ${leverage}x`)
        console.log(`  Margin    : ${isLong ? fmtUsd(ethers.formatUnits(marginAmount, 6)) : ethers.formatEther(marginAmount) + " ETH"}`)
        console.log(`  Notional  : ${isLong ? fmtUsd(ethers.formatUnits(notional, 6)) : ethers.formatEther(notional) + " ETH"}`)

        // ── OPEN ─────────────────────────────────────────────────
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint8", "address"],
            [true, leverage, trader.address]
        )

        const zeroForOne = isLong ? false : true  // long = pay USDC (token1), short = pay ETH (token0)

        const swapParams = {
            key: poolKey,
            standardPoolKey: standardPoolKey,
            zeroForOne: zeroForOne,
            amountSpecified: -marginAmount,
            leverage: leverage,
            solver: solverAddr || trader.address,
            hookData: hookData,
            deadline: Math.floor(Date.now() / 1000) + 600,
            minAmountOut: 0n,
        }

        let msgValue = 0n
        if (!isLong) {
            msgValue = notional // ETH short: margin + borrow as msg.value
        }

        if (DRY_RUN) {
            console.log(`  (dry-run: would call router.swapMultiPool)`)
        } else {
            try {
                const tx = await send(traderRouter.swapMultiPool(swapParams, { value: msgValue, gasLimit: 1_000_000n, nonce: await nextNonce() }))
                const receipt = await tx.wait()
                console.log(`  ${GREEN}OPENED${RESET} — Tx: ${tx.hash.slice(0, 18)}… Gas: ${receipt.gasUsed}`)
            } catch (e) {
                console.error(`  ${RED}OPEN FAILED: ${e.message}${RESET}`)
                await new Promise(r => setTimeout(r, MIN_INTERVAL_MS))
                continue
            }
        }

        // ── HOLD ─────────────────────────────────────────────────
        const holdMs = rand(MIN_HOLD_MS, MAX_HOLD_MS)
        console.log(`  Holding for ${(holdMs / 60_000).toFixed(1)} min…`)
        await new Promise(r => setTimeout(r, holdMs))

        // ── CLOSE ────────────────────────────────────────────────
        console.log(`  Closing position…`)

        if (DRY_RUN) {
            console.log(`  (dry-run: would call router.closePosition)`)
        } else {
            try {
                const closeTx = await send(traderRouter.closePosition(
                    hookAddr, poolKey, trader.address, solverAddr || trader.address, 0n, { gasLimit: 5_000_000n, nonce: await nextNonce() }
                ))
                const closeReceipt = await closeTx.wait()
                console.log(`  ${GREEN}CLOSED${RESET} — Tx: ${closeTx.hash.slice(0, 18)}… Gas: ${closeReceipt.gasUsed}`)
            } catch (e) {
                console.error(`  ${RED}CLOSE FAILED: ${e.message}${RESET}`)
            }
        }

        // ── Snapshot after trade ─────────────────────────────────
        if (!DRY_RUN) {
            try {
                const pos = await hook.positions(poolId, trader.address)
                const hasPosition = pos[1] !== 0n
                const ethBalAfter = await provider.getBalance(trader.address)
                const usdcBalAfter = await usdc.balanceOf(trader.address)

                console.log(`\n  Post-trade state:`)
                console.log(`    Active Position : ${hasPosition ? "YES" : "NO (clean)"}`)
                console.log(`    ETH Balance     : ${ethers.formatEther(ethBalAfter)}`)
                console.log(`    USDC Balance    : ${ethers.formatUnits(usdcBalAfter, 6)}`)

                // Protocol fees check
                const protocolFees = await hook.protocolFees(USDC)
                const insuranceFund = await hook.insuranceFund(USDC)
                console.log(`    Protocol Fees   : ${ethers.formatUnits(protocolFees, 6)} USDC`)
                console.log(`    Insurance Fund  : ${ethers.formatUnits(insuranceFund, 6)} USDC`)
            } catch (e) {
                console.error(`  (snapshot error: ${e.message})`)
            }
        }

        cycleNum++

        // ── Random interval ──────────────────────────────────────
        // Bounded run: exit after MAX_CYCLES complete trades.
        if (cycleNum >= MAX_CYCLES) {
            console.log(`\n${CYAN}═══ BOUNDED RUN COMPLETE (${cycleNum} trade${cycleNum === 1 ? "" : "s"}) ═══${RESET}`)
            break
        }
        const nextInterval = rand(MIN_INTERVAL_MS, MAX_INTERVAL_MS)
        console.log(`\n  Next trade in ${(nextInterval / 60_000).toFixed(1)} min…`)
        await new Promise(r => setTimeout(r, nextInterval))
    }
}

main().catch(e => { console.error(e); process.exit(1) })
