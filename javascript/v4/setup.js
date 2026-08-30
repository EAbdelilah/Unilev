/**
 * v4/setup.js — One-time post-deploy setup: whitelist solver, set min collateral
 *
 * Run ONCE after deploying:
 *   node javascript/v4/setup.js
 *
 * What it does:
 *   1. Whitelists SOLVER_ADDRESS on the router
 *   2. Sets minCollateralUsd to $0.05 on the hook
 *   3. Prints a final status report
 */
const { ethers } = require("ethers")
const { setup, printBalances } = require("./utils")

async function main() {
    const { provider, wallet, hook, router, pf, hookAddr, routerAddr, solverAddr } = setup()

    console.log(`\n${"═".repeat(58)}`)
    console.log(`  V4 Post-Deploy Setup`)
    console.log(`  Deployer/Owner : ${wallet.address}`)
    console.log(`  Hook           : ${hookAddr}`)
    console.log(`  Router         : ${routerAddr}`)
    console.log(`${"═".repeat(58)}\n`)

    // ── 1. Verify caller is hook owner ────────────────────────────────────────
    const owner = await hook.owner()
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        console.error(`❌  Caller is not hook owner. Owner=${owner}`)
        process.exit(1)
    }
    console.log(`✅  Caller is hook owner`)

    // ── 2. Set minCollateralUsd = $0.05 ──────────────────────────────────────
    // $0.05 in 18-dec = 50_000_000_000_000_000
    const TARGET_MIN_USD = 50_000_000_000_000_000n
    const current = await hook.minCollateralUsd()
    if (current !== TARGET_MIN_USD) {
        console.log(`\n🔧  Setting minCollateralUsd to $0.05…`)
        const tx = await hook.setRouterAndMinCollateralUsd(routerAddr, TARGET_MIN_USD)
        await tx.wait()
        console.log(`    ✅  Done`)
    } else {
        console.log(`    ✅  minCollateralUsd already $0.05`)
    }

    // ── 3. Whitelist solver on router ─────────────────────────────────────────
    if (solverAddr && solverAddr !== ethers.ZeroAddress) {
        console.log(`\n🔧  Whitelisting solver ${solverAddr} on router…`)
        try {
            const routerOwner = await router.setSolverWhitelist.staticCall(solverAddr, true)
        } catch {}
        const tx = await router.setSolverWhitelist(solverAddr, true)
        await tx.wait()
        console.log(`    ✅  Solver whitelisted`)
    } else {
        console.log(`\n⚠️  No SOLVER_ADDRESS in .env — skipping whitelist`)
        console.log(`    For self-solving tests, set SOLVER_ADDRESS=${wallet.address}`)
        // Whitelist the deployer EOA as default test solver
        console.log(`    Whitelisting deployer as test solver…`)
        const tx = await router.setSolverWhitelist(wallet.address, true)
        await tx.wait()
        console.log(`    ✅  Deployer whitelisted as solver`)
    }

    // ── 4. Status report ──────────────────────────────────────────────────────
    console.log(`\n📊 Final status:`)
    const minUsd  = await hook.minCollateralUsd()
    const hookRtr = await hook.router()
    console.log(`    minCollateralUsd : $${ethers.formatUnits(minUsd, 18)}`)
    console.log(`    hook.router      : ${hookRtr}`)

    console.log("\n📊 Balances:")
    await printBalances(wallet, pf)

    console.log(`\n✅  Setup complete. You can now run:`)
    console.log(`    node javascript/v4/openLong.js         # Long ETH/USDC $0.05`)
    console.log(`    node javascript/v4/openShort.js        # Short ETH/USDC $0.05`)
    console.log(`    node javascript/v4/openLong.js wbtc    # Long WBTC/USDC $0.05`)
    console.log(`    node javascript/v4/openShort.js wbtc   # Short WBTC/USDC $0.05`)
    console.log(`    node javascript/v4/checkPositions.js   # Check all positions`)
    console.log(`    node javascript/v4/closePosition.js    # Close ETH/USDC position`)
    console.log()
}

main().catch(e => { console.error(e); process.exit(1) })
