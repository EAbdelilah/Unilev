/**
 * javascript/v4/solverBot.js
 * Solver Bot — seeds the hook pool with borrowable capital, monitors
 * rehypothecation yield and protocol health metrics.
 *
 * Run:
 *   node javascript/v4/solverBot.js
 *
 * What it does:
 *   1. Checks solver wallet balances (ETH + USDC)
 *   2. Reports pool state: available liquidity, collateral, insurance fund
 *   3. Monitors solver debt positions and rehypothecation yield
 *   4. Reports protocol fees accrued
 *   5. Loops every INTERVAL_MS to continuously report
 */
const { ethers } = require("ethers")
const { setup, printBalances, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, poolId: computePoolId } = require("./poolKeys")

const INTERVAL_MS = 60_000 // report every 60 seconds

const GREEN  = "\x1b[32m"
const CYAN   = "\x1b[36m"
const YELLOW = "\x1b[33m"
const RED    = "\x1b[31m"
const RESET  = "\x1b[0m"

function fmtUsd(raw, dec = 18) {
    const v = parseFloat(ethers.formatUnits(raw, dec))
    return v < 0.01 ? `$${v.toFixed(6)}` : `$${v.toFixed(2)}`
}

function fmtToken(raw, dec = 18) {
    return parseFloat(ethers.formatUnits(raw, dec)).toFixed(6)
}

async function snapshot(provider, wallet, hook, pf, poolKey, poolId) {
    const addr = wallet.address
    const now = new Date().toISOString().slice(11, 19)

    console.log(`\n${CYAN}━━━ Solver Bot Snapshot [${now}] ━━━${RESET}`)

    // ── Wallet balances ──────────────────────────────────────────
    const ethBal = await provider.getBalance(addr)
    const usdcContract = new ethers.Contract(USDC, ERC20_ABI, provider)
    const usdcBal = await usdcContract.balanceOf(addr)

    let ethUsd = 0n, usdcUsd = 0n
    try { ethUsd = await pf.getAmountInUsd(ETH, ethBal) } catch {}
    try { usdcUsd = await pf.getAmountInUsd(USDC, usdcBal) } catch {}

    console.log(`  Wallet:`)
    console.log(`    ETH  : ${fmtToken(ethBal)}  (~${fmtUsd(ethUsd)})`)
    console.log(`    USDC : ${fmtToken(usdcBal, 6)}  (~${fmtUsd(usdcUsd, 6)})`)

    // ── Protocol metrics ─────────────────────────────────────────
    const totalCollateral = await hook.totalCollateral(USDC)
    const totalBorrowed = await hook.totalBorrowedByToken(USDC)
    const insuranceFund = await hook.insuranceFund(USDC)
    const protocolFees = await hook.protocolFees(USDC)
    const totalOI = await hook.totalOpenInterestUSD()
    const totalColUsd = await hook.totalCollateralUSDRunning()
    const reserveFactor = await hook.reserveFactor()

    console.log(`\n  Protocol:`)
    console.log(`    Reserve Factor     : ${reserveFactor} bps`)
    console.log(`    Total Collateral   : ${fmtToken(totalCollateral, 6)} USDC  (~${fmtUsd(totalColUsd)})`)
    console.log(`    Total Borrowed     : ${fmtToken(totalBorrowed, 6)} USDC`)
    console.log(`    Insurance Fund     : ${fmtToken(insuranceFund, 6)} USDC`)
    console.log(`    Protocol Fees      : ${fmtToken(protocolFees, 6)} USDC`)
    console.log(`    Open Interest      : ${fmtUsd(totalOI)}`)

    // ── Solvency check ───────────────────────────────────────────
    const obligations = totalCollateral + insuranceFund + protocolFees
    const usdcBalHook = await usdcContract.balanceOf(hook.target)
    const surplus = usdcBalHook > obligations ? usdcBalHook - obligations : 0n
    const deficit = usdcBalHook < obligations ? obligations - usdcBalHook : 0n

    console.log(`\n  Solvency:`)
    console.log(`    Hook USDC Balance  : ${fmtToken(usdcBalHook, 6)} USDC`)
    console.log(`    Obligations        : ${fmtToken(obligations, 6)} USDC`)
    if (deficit > 0n) {
        console.log(`    ${RED}⚠  DEFICIT           : ${fmtToken(deficit, 6)} USDC${RESET}`)
    } else {
        console.log(`    ${GREEN}Surplus             : ${fmtToken(surplus, 6)} USDC${RESET}`)
    }

    // ── Solver debt registry ─────────────────────────────────────
    // Scan for any active solver debt positions
    const oic = await hook.openInterestCapacity()
    const hasCapacity = oic[0]
    const maxSingle = oic[1]
    const maxTotal = oic[2]
    const currentOI = oic[3]
    const tvlFloor = oic[4]

    console.log(`\n  OI Capacity:`)
    console.log(`    Has Capacity   : ${hasCapacity}`)
    console.log(`    Max Single     : ${fmtUsd(maxSingle)}`)
    console.log(`    Max Total      : ${fmtUsd(maxTotal)}`)
    console.log(`    Current OI     : ${fmtUsd(currentOI)}`)
    console.log(`    TVL Floor      : ${fmtUsd(tvlFloor)}`)

    // ── Rehypothecation hint ─────────────────────────────────────
    const standardPool = await hook.standardPoolKeys(poolId)
    console.log(`\n  Rehypothecation:`)
    console.log(`    Standard Pool  : ${standardPool.currency0}/${standardPool.currency1} fee=${standardPool.fee} tick=${standardPool.tickSpacing}`)
    console.log(`    (Solver LP in standard pool earns swap fees on idle capital)`)

    // ── Residue ──────────────────────────────────────────────────
    try {
        const residue = await hook.sweepableResidue(USDC)
        if (residue > 0n) {
            console.log(`\n  ${YELLOW}Sweepable Residue : ${fmtToken(residue, 6)} USDC${RESET}`)
        }
    } catch {}

    // ── Price check ──────────────────────────────────────────────
    const ethPrice = await pf.getAmountInUsd(ETH, ethers.parseEther("1"))
    console.log(`\n  ETH Price: ${fmtUsd(ethPrice)}`)
}

async function main() {
    const { provider, wallet, hook, pf, hookAddr, solverAddr } = setup()

    const poolKey = HOOK_POOL_KEY
    const poolId = computePoolId(HOOK_POOL_KEY)

    console.log(`\n${"═".repeat(58)}`)
    console.log(`  SOLVER BOT — Eswap V4 Unichain`)
    console.log(`  Solver     : ${wallet.address}`)
    console.log(`  Hook       : ${hookAddr}`)
    console.log(`  Interval   : ${INTERVAL_MS / 1000}s`)
    console.log(`${"═".repeat(58)}`)

    const isWhitelisted = await hook.registeredSolvers
        ? true
        : await new ethers.Contract(
            process.env.V4_ROUTER_ADDRESS,
            ["function registeredSolvers(address) view returns (bool)"],
            provider
          ).registeredSolvers(wallet.address)

    // use router directly for solver check
    const routerRead = new ethers.Contract(
        process.env.V4_ROUTER_ADDRESS,
        ["function registeredSolvers(address) view returns (bool)"],
        provider
    )
    const whitelisted = await routerRead.registeredSolvers(wallet.address)
    console.log(`  Solver Whitelisted: ${whitelisted ? "✅ YES" : "❌ NO — run setup.js first"}`)

    // One immediate snapshot
    await snapshot(provider, wallet, hook, pf, poolKey, poolId)

    // Loop
    console.log(`\n${GREEN}  Running… (Ctrl+C to stop)${RESET}`)
    while (true) {
        await new Promise(r => setTimeout(r, INTERVAL_MS))
        try {
            await snapshot(provider, wallet, hook, pf, poolKey, poolId)
        } catch (e) {
            console.error(`${RED}  Snapshot error: ${e.message}${RESET}`)
        }
    }
}

main().catch(e => { console.error(e); process.exit(1) })
