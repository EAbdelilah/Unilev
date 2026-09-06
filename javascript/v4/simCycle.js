/**
 * javascript/v4/simCycle.js
 * Deterministic full-cycle driver for the anvil Unichain fork SIMULATION.
 *
 * Modes:
 *   open   – opens a 3x LONG (trader + solver = same EOA), deploys the rehyp
 *            band, then registers the position on the keeper watch list.
 *   state  – dumps the position tuple, rehyp state, protocol solvency and
 *            keeper watch list (used before/after the keeper liquidation).
 *
 * The oracle crash (+ price restore) that triggers the keeper leg is driven
 * externally via `cast send <mock> setAnswer(...)` so the RPC-level sequence
 * stays visible. All opens send 5M gas so deployCollateral can never silently
 * skip (the historical live bug).
 */
const { ethers } = require("ethers")
const { setup, loadAbi, ERC20_ABI, ETH, USDC } = require("./utils")
const { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId: computePoolId } = require("./poolKeys")

const GREEN = "\x1b[32m", YELLOW = "\x1b[33m", RED = "\x1b[31m", RESET = "\x1b[0m"

const MARGIN_USD = "0.06"   // $0.06 USDC margin (>$0.05 floor after 50bps fee shave)
const LEVERAGE = 3          // 3x -> liquidatable after a ~50% adverse move

async function open() {
    const { provider, wallet, hook, router, pf, hookAddr, keeperAddr, solverAddr } = setup()
    const keeper = new ethers.Contract(keeperAddr, loadAbi("EswapLiquidationKeeper"), wallet)
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)

    const poolKey = HOOK_POOL_KEY
    const poolId = computePoolId(HOOK_POOL_KEY)

    const margin = ethers.parseUnits(MARGIN_USD, 6)
    const borrow = margin * BigInt(LEVERAGE - 1)

    const allowance = await usdc.allowance(wallet.address, router.target)
    if (allowance < margin + borrow) {
        console.log("Approving USDC (margin + borrow) to router…")
        const tx = await usdc.approve(router.target, ethers.MaxUint256)
        await tx.wait()
    }

    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, LEVERAGE, wallet.address])
    const params = {
        key: poolKey,
        standardPoolKey: STANDARD_POOL_KEY,
        zeroForOne: false,                      // long ETH: pay USDC (token1)
        amountSpecified: -margin,
        leverage: LEVERAGE,
        solver: solverAddr || wallet.address,
        hookData,
    }

    console.log(`\n${"═".repeat(58)}`)
    console.log(` SIM OPEN — LONG ETH  ${LEVERAGE}x  (${MARGIN_USD} USDC margin / ${ethers.formatUnits(borrow, 6)} borrow)`)
    console.log(` Trader = Solver = ${wallet.address}`)
    console.log(`${"═".repeat(58)}`)

    const tx = await router.swapMultiPool(params, { gasLimit: 5_000_000n })
    const rec = await tx.wait()
    console.log(`${GREEN}OPENED${RESET} tx=${tx.hash} gas=${rec.gasUsed}`)

    const pos = await hook.positions(poolId, wallet.address)
    const rehyp = await hook.rehypPrincipal(poolId, wallet.address)
    console.log(` collateral=${ethers.formatUnits(pos[1].toString(), 6)} USDC borrow=${ethers.formatUnits(pos[2].toString(), 6)} lev=${pos[3].toString()} ${pos[4] ? "LONG" : "SHORT"}`)
    console.log(` band ticks=[${pos[6].toString()}, ${pos[7].toString()}] liquidity=${pos[8].toString()}`)
    console.log(` rehypPrincipal=${rehyp.toString()}  ${rehyp === 0n ? RED + "SKIPPED" : GREEN + "DEPLOYED"}${RESET}`)

    // Register on the keeper watch list so the keeper lock can liquidate it.
    try {
        console.log("Adding watch on keeper…")
        const wtx = await keeper.addWatch(poolKey, wallet.address)
        await wtx.wait()
        console.log(`${GREEN}WATCHED${RESET} tx=${wtx.hash}`)
    } catch (e) {
        if (!/AlreadyWatched|already/.test(e.message)) throw e
        console.log("Already watched (idempotent).")
    }

    console.log(`\nPre-crash liquidatable: ${await hook.isLiquidatable(
        { trader: pos[0], collateralAmount: pos[1], borrowedAmount: pos[2], leverage: pos[3], isLong: pos[4], liquidationSqrtPrice: pos[5], tickLower: pos[6], tickUpper: pos[7], liquidity: pos[8] },
        poolKey
    )}`)
}

async function state() {
    const { provider, wallet, hook, pf, keeperAddr, solverAddr } = setup()
    const keeper = new ethers.Contract(keeperAddr, loadAbi("EswapLiquidationKeeper"), provider)
    const usdc = new ethers.Contract(USDC, ERC20_ABI, provider)
    const poolId = computePoolId(HOOK_POOL_KEY)

    const pos = await hook.positions(poolId, wallet.address)
    const rehyp = await hook.rehypPrincipal(poolId, wallet.address)

    console.log(`\n${"═".repeat(58)}`)
    console.log(` SIM STATE`)
    console.log(`${"═".repeat(58)}`)
    console.log(` Position        : ${pos[0] === ethers.ZeroAddress ? "CLOSED (cleared)" : "OPEN"}`)
    if (pos[0] !== ethers.ZeroAddress) {
        console.log(`   collateral=${ethers.formatUnits(pos[1].toString(), 6)} borrow=${ethers.formatUnits(pos[2].toString(), 6)} lev=${pos[3].toString()}`)
        console.log(`   band=[${pos[6].toString()}, ${pos[7].toString()}] liq=${pos[8].toString()}`)
        console.log(`   rehypPrincipal=${rehyp.toString()}`)
        const liq = await hook.isLiquidatable(
            { trader: pos[0], collateralAmount: pos[1], borrowedAmount: pos[2], leverage: pos[3], isLong: pos[4], liquidationSqrtPrice: pos[5], tickLower: pos[6], tickUpper: pos[7], liquidity: pos[8] },
            HOOK_POOL_KEY
        )
        console.log(`   isLiquidatable=${liq}`)
    }
    console.log(` Insurance fund : ${ethers.formatUnits((await hook.insuranceFund(USDC)).toString(), 6)} USDC`)
    console.log(` Protocol fees  : ${ethers.formatUnits((await hook.protocolFees(USDC)).toString(), 6)} USDC`)
    console.log(` Trader USDC    : ${ethers.formatUnits((await usdc.balanceOf(wallet.address)).toString(), 6)}`)
    console.log(` Trader ETH     : ${ethers.formatEther(await provider.getBalance(wallet.address))}`)

    const len = await keeper.watchesLength()
    console.log(` Keeper watches : ${len.toString()}`)
}

const mode = process.argv[2] || "open"
;(mode === "open" ? open() : state()).catch(e => { console.error(e); process.exit(1) })