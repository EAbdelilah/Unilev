/**
 * javascript/v4/testAllProduction.js
 * Comprehensive End-to-End Production Verification Suite on Unichain Mainnet.
 *
 * Test Suites:
 *  1. Solver Whitelist & Access Control Verification
 *  2. Live 5x LONG Position Lifecycle (Open 5x, Storage Invariants, Solver Debt, Close, State Cleanup)
 *  3. Live 5x SHORT Position Lifecycle (Open 5x, Storage Invariants, Solver Debt, Close, State Cleanup)
 *  4. Liquidation Keeper & Automation Invariants
 *  5. Chainlink PriceFeed & Oracle Sanity
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI } = require("./utils")

const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const YELLOW = "\x1b[33m"
const RESET = "\x1b[0m"

const delay = (ms) => new Promise(r => setTimeout(r, ms))

function logPass(title, detail = "") {
    console.log(`  ${GREEN}✔ PASS:${RESET} ${title} ${detail ? `(${detail})` : ""}`)
}

function logFail(title, error) {
    console.log(`  ${RED}✖ FAIL:${RESET} ${title}`)
    console.error(`    ${RED}Reason: ${error.message || error}${RESET}`)
}

function logHeader(title) {
    console.log(`\n${CYAN}====================================================`)
    console.log(`  ${title}`)
    console.log(`====================================================${RESET}`)
}

async function main() {
    const { provider, wallet, hook, router, pf, hookAddr, routerAddr, keeperAddr, solverAddr, ETH, USDC } = setup()

    const keeperAbi = [
        "function hook() view returns (address)",
        "function router() view returns (address)",
        "function quoteMinAmountOut(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) view returns (uint256)",
        "function checkUpkeep(bytes calldata checkData) view returns (bool upkeepNeeded, bytes memory performData)",
        "function addWatch(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, address trader) external",
        "function isWatched(bytes32 id) view returns (bool)",
        "function watchesLength() view returns (uint256)"
    ]
    const keeper = new ethers.Contract(keeperAddr, keeperAbi, wallet)

    console.log(`Network:           Unichain Mainnet (Chain ID: ${(await provider.getNetwork()).chainId})`)
    console.log(`Deployer / Solver: ${wallet.address}`)
    console.log(`Hook:              ${hookAddr}`)
    console.log(`Router:            ${routerAddr}`)
    console.log(`Keeper:            ${keeperAddr}`)

    const poolKey = {
        currency0: ETH,
        currency1: USDC,
        fee: 500,
        tickSpacing: 10,
        hooks: hookAddr
    }
    const standardPoolKey = {
        currency0: ETH,
        currency1: USDC,
        fee: 500,
        tickSpacing: 10,
        hooks: ethers.ZeroAddress
    }
    const poolId = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['address','address','uint24','int24','address'],
        [ETH, USDC, 500, 10, hookAddr]
    ))

    let totalTests = 0
    let passedTests = 0

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 1: Configuration & Solver Access Control
    // ─────────────────────────────────────────────────────────────
    logHeader("1. Solver Whitelist & Access Control Verification")
    
    totalTests++
    try {
        const isWhitelisted = await router.registeredSolvers(solverAddr)
        if (!isWhitelisted) throw new Error(`Solver ${solverAddr} is not whitelisted on router!`)
        logPass("Solver is properly whitelisted on Router", `Solver: ${solverAddr.slice(0, 10)}...`)
        passedTests++
    } catch (e) {
        logFail("Solver whitelist check", e)
    }

    totalTests++
    try {
        const randomAddr = ethers.Wallet.createRandom().address
        const isRandomWhitelisted = await router.registeredSolvers(randomAddr)
        if (isRandomWhitelisted) throw new Error("Random unapproved address is whitelisted!")
        logPass("Unauthorized solver is correctly rejected by default")
        passedTests++
    } catch (e) {
        logFail("Unauthorized solver rejection", e)
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 2: Full LONG Position Lifecycle (5x Leverage)
    // ─────────────────────────────────────────────────────────────
    logHeader("2. Live 5x Long Position Lifecycle on ETH/USDC")
    const longLeverage = 5
    const longMargin = ethers.parseUnits("0.02", 6) // $0.02 USDC margin
    const longBorrow = longMargin * BigInt(longLeverage - 1) // $0.08 USDC borrow
    const longNotional = longMargin + longBorrow // $0.10 USDC notional

    try {
        totalTests++
        const usdcContract = new ethers.Contract(USDC, ERC20_ABI, wallet)
        const allowance = await usdcContract.allowance(wallet.address, routerAddr)
        if (allowance < longNotional) {
            const atx = await usdcContract.approve(routerAddr, ethers.MaxUint256)
            await atx.wait()
        }

        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint8", "address"],
            [true, longLeverage, wallet.address]
        )

        const swapParams = {
            key: poolKey,
            standardPoolKey: standardPoolKey,
            zeroForOne: false, // pay USDC, receive ETH (Long)
            amountSpecified: -longMargin,
            leverage: longLeverage,
            solver: solverAddr,
            hookData: hookData
        }

        console.log(`  Opening 5x Long: Margin = ${ethers.formatUnits(longMargin, 6)} USDC, Notional = ${ethers.formatUnits(longNotional, 6)} USDC...`)
        const openTx = await router.swapMultiPool(swapParams)
        const openReceipt = await openTx.wait()
        logPass("5x Long Position Opened on Unichain", `Tx: ${openTx.hash.slice(0, 18)}..., Gas: ${openReceipt.gasUsed}`)
        passedTests++

        // Verify on-chain position state
        totalTests++
        const pos = await hook.positions(poolId, wallet.address)
        if (pos[0].toLowerCase() !== wallet.address.toLowerCase()) throw new Error(`Trader mismatch: got ${pos[0]}, expected ${wallet.address}`)
        if (pos[1] === 0n) throw new Error("Collateral is zero")
        if (pos[2] !== longBorrow) throw new Error(`Borrowed amount mismatch: expected ${longBorrow}, got ${pos[2]}`)
        if (Number(pos[3]) !== longLeverage) throw new Error(`Leverage mismatch: expected ${longLeverage}, got ${pos[3]}`)
        if (pos[4] !== true) throw new Error("isLong should be true")

        logPass("On-Chain Position Accounting Verified", `Collateral: ${ethers.formatEther(pos[1])} ETH, Borrowed: ${ethers.formatUnits(pos[2], 6)} USDC, Lev: ${pos[3]}x`)
        passedTests++

        // Verify Solver Debt Registration
        totalTests++
        const solverDebt = await hook.solverDebts(poolId, wallet.address, solverAddr)
        if (solverDebt[1] !== longBorrow) throw new Error(`Solver debt principal mismatch: ${solverDebt[1]} != ${longBorrow}`)
        logPass("Solver Debt Guaranteed On-Chain", `Principal: ${ethers.formatUnits(solverDebt[1], 6)} USDC`)
        passedTests++

        // Verify Position is NOT liquidatable (healthy)
        totalTests++
        const posParam = {
            trader: pos[0],
            collateralAmount: pos[1],
            borrowedAmount: pos[2],
            leverage: pos[3],
            isLong: pos[4],
            liquidationSqrtPrice: pos[5],
            tickLower: pos[6],
            tickUpper: pos[7],
            liquidity: pos[8]
        }
        const isLiq = await hook.isLiquidatable(posParam, poolKey)
        if (isLiq) throw new Error("Newly opened position incorrectly marked as liquidatable!")
        logPass("Healthy Long Position is NOT Liquidatable", "isLiquidatable = false")
        passedTests++

        // Close Long Position
        totalTests++
        console.log(`  Closing 5x Long Position...`)
        const closeTx = await router.closePosition(hookAddr, poolKey, wallet.address, solverAddr, 0n)
        const closeReceipt = await closeTx.wait()
        logPass("5x Long Position Closed Cleanly", `Tx: ${closeTx.hash.slice(0, 18)}..., Gas: ${closeReceipt.gasUsed}`)
        passedTests++

        // Await RPC sync
        await delay(2000)

        // Verify Position Deleted
        totalTests++
        const posAfter = await hook.positions(poolId, wallet.address)
        if (posAfter[1] !== 0n || posAfter[2] !== 0n) throw new Error("Position not cleaned up in storage!")
        logPass("Position State Fully Cleared After Close")
        passedTests++
    } catch (e) {
        logFail("5x Long Lifecycle Failed", e)
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 3: Full SHORT Position Lifecycle (5x Leverage)
    // ─────────────────────────────────────────────────────────────
    logHeader("3. Live 5x Short Position Lifecycle on ETH/USDC")
    const shortLeverage = 5
    const shortMargin = ethers.parseEther("0.000008") // 0.000008 ETH margin (~$0.02)
    const shortBorrow = shortMargin * BigInt(shortLeverage - 1) // 0.000032 ETH borrow
    const shortNotional = shortMargin + shortBorrow // 0.000040 ETH notional (~$0.10)

    try {
        totalTests++
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint8", "address"],
            [true, shortLeverage, wallet.address]
        )

        const swapParams = {
            key: poolKey,
            standardPoolKey: standardPoolKey,
            zeroForOne: true, // pay ETH, receive USDC (Short)
            amountSpecified: -shortMargin,
            leverage: shortLeverage,
            solver: solverAddr,
            hookData: hookData
        }

        console.log(`  Opening 5x Short: Margin = ${ethers.formatEther(shortMargin)} ETH, Notional = ${ethers.formatEther(shortNotional)} ETH...`)
        const openTx = await router.swapMultiPool(swapParams, { value: shortNotional })
        const openReceipt = await openTx.wait()
        logPass("5x Short Position Opened on Unichain", `Tx: ${openTx.hash.slice(0, 18)}..., Gas: ${openReceipt.gasUsed}`)
        passedTests++

        // Verify on-chain position state
        totalTests++
        const pos = await hook.positions(poolId, wallet.address)
        if (pos[0].toLowerCase() !== wallet.address.toLowerCase()) throw new Error(`Trader mismatch: got ${pos[0]}, expected ${wallet.address}`)
        if (pos[1] === 0n) throw new Error("Collateral is zero")
        if (pos[2] !== shortBorrow) throw new Error(`Borrowed amount mismatch: expected ${shortBorrow}, got ${pos[2]}`)
        if (Number(pos[3]) !== shortLeverage) throw new Error(`Leverage mismatch: expected ${shortLeverage}, got ${pos[3]}`)
        if (pos[4] !== false) throw new Error("isLong should be false for Short")

        logPass("On-Chain Position Accounting Verified", `Collateral: ${ethers.formatUnits(pos[1], 6)} USDC, Borrowed: ${ethers.formatEther(pos[2])} ETH, Lev: ${pos[3]}x`)
        passedTests++

        // Verify Solver Debt Registration
        totalTests++
        const solverDebt = await hook.solverDebts(poolId, wallet.address, solverAddr)
        if (solverDebt[1] !== shortBorrow) throw new Error(`Solver debt principal mismatch: ${solverDebt[1]} != ${shortBorrow}`)
        logPass("Solver Debt Guaranteed On-Chain", `Principal: ${ethers.formatEther(solverDebt[1])} ETH`)
        passedTests++

        // Verify Position is NOT liquidatable (healthy)
        totalTests++
        const posParamShort = {
            trader: pos[0],
            collateralAmount: pos[1],
            borrowedAmount: pos[2],
            leverage: pos[3],
            isLong: pos[4],
            liquidationSqrtPrice: pos[5],
            tickLower: pos[6],
            tickUpper: pos[7],
            liquidity: pos[8]
        }
        const isLiq = await hook.isLiquidatable(posParamShort, poolKey)
        if (isLiq) throw new Error("Newly opened short position incorrectly marked as liquidatable!")
        logPass("Healthy Short Position is NOT Liquidatable", "isLiquidatable = false")
        passedTests++

        // Close Short Position
        totalTests++
        console.log(`  Closing 5x Short Position...`)
        const closeTx = await router.closePosition(hookAddr, poolKey, wallet.address, solverAddr, 0n)
        const closeReceipt = await closeTx.wait()
        logPass("5x Short Position Closed Cleanly", `Tx: ${closeTx.hash.slice(0, 18)}..., Gas: ${closeReceipt.gasUsed}`)
        passedTests++

        // Await RPC sync
        await delay(2000)

        // Verify Position Deleted
        totalTests++
        const posAfter = await hook.positions(poolId, wallet.address)
        if (posAfter[1] !== 0n || posAfter[2] !== 0n) throw new Error("Position not cleaned up in storage!")
        logPass("Position State Fully Cleared After Close")
        passedTests++
    } catch (e) {
        logFail("5x Short Lifecycle Failed", e)
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 4: Liquidation Keeper & Automation Interface
    // ─────────────────────────────────────────────────────────────
    logHeader("4. Liquidation Keeper & Automation Invariants")
    
    totalTests++
    try {
        const quote = await keeper.quoteMinAmountOut(poolKey, wallet.address)
        if (quote !== 0n) throw new Error("Non-existent position returned non-zero liquidation quote!")
        logPass("Closed position returns 0 liquidation quote")
        passedTests++
    } catch (e) {
        logFail("Keeper quoteMinAmountOut check", e)
    }

    totalTests++
    try {
        const [upkeepNeeded, performData] = await keeper.checkUpkeep("0x")
        if (upkeepNeeded) throw new Error("Upkeep needed reported when no positions are liquidatable!")
        logPass("Chainlink Automation checkUpkeep correctly reports upkeepNeeded = false")
        passedTests++
    } catch (e) {
        logFail("Keeper checkUpkeep check", e)
    }

    totalTests++
    try {
        // Test keeper scan with candidate data
        const checkData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)[]", "address[]"],
            [[poolKey], [wallet.address]]
        )
        const [upkeepNeeded2] = await keeper.checkUpkeep(checkData)
        if (upkeepNeeded2) throw new Error("Candidate scan reported upkeep needed on healthy account!")
        logPass("Candidate scan accurately checks off-chain candidate list")
        passedTests++
    } catch (e) {
        logFail("Keeper candidate scan check", e)
    }

    // ─────────────────────────────────────────────────────────────
    // TEST SUITE 5: PriceFeed Oracle & Circuit Breakers
    // ─────────────────────────────────────────────────────────────
    logHeader("5. Chainlink PriceFeed & Oracle Sanity")
    
    totalTests++
    try {
        const ethPriceUsd = await pf.getAmountInUsd(ETH, ethers.parseEther("1"))
        const formattedPrice = ethers.formatUnits(ethPriceUsd, 18)
        const priceNum = parseFloat(formattedPrice)
        if (priceNum < 500 || priceNum > 100000) throw new Error(`Out of range ETH price: $${priceNum}`)
        logPass("ETH/USD Oracle is live and accurate", `$${priceNum.toFixed(2)} / ETH`)
        passedTests++
    } catch (e) {
        logFail("Oracle price check for ETH", e)
    }

    totalTests++
    try {
        const usdcPriceUsd = await pf.getAmountInUsd(USDC, ethers.parseUnits("1", 6))
        const formattedUsdc = parseFloat(ethers.formatUnits(usdcPriceUsd, 18))
        if (formattedUsdc < 0.90 || formattedUsdc > 1.10) throw new Error(`USDC depeg in oracle: $${formattedUsdc}`)
        logPass("USDC/USD Oracle is live and pegged", `$${formattedUsdc.toFixed(4)} / USDC`)
        passedTests++
    } catch (e) {
        logFail("Oracle price check for USDC", e)
    }

    // ─────────────────────────────────────────────────────────────
    // SUMMARY
    // ─────────────────────────────────────────────────────────────
    logHeader("PRODUCTION READINESS SUMMARY")
    console.log(`  Total Invariant Tests: ${totalTests}`)
    console.log(`  ${GREEN}Passed Tests:          ${passedTests}${RESET}`)
    console.log(`  ${passedTests === totalTests ? GREEN : RED}Failed Tests:          ${totalTests - passedTests}${RESET}`)

    if (passedTests === totalTests) {
        console.log(`\n${GREEN}🚀 ALL ${totalTests} PRODUCTION TESTS PASSED WITH 100% SUCCESS ON UNICHAIN MAINNET!${RESET}\n`)
    } else {
        console.log(`\n${RED}⚠️  SOME TESTS FAILED!${RESET}\n`)
        process.exit(1)
    }
}

main().catch((err) => {
    console.error(`${RED}Fatal Error:${RESET}`, err)
    process.exit(1)
})
