/**
 * javascript/v4/openLong.js
 * Opens a LIVE Long position on Unichain mainnet.
 * Usage: node javascript/v4/openLong.js [eth|wbtc]
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI } = require("./utils")

async function main() {
    const { provider, wallet, router, hookAddr, solverAddr, ETH, USDC, WBTC } = setup()

    const arg = process.argv[2] || "eth"
    const isWbtc = arg.toLowerCase() === "wbtc"

    const baseToken = isWbtc ? WBTC : ETH
    const quoteToken = USDC
    
    console.log(`\n=== Opening LONG on ${isWbtc ? 'WBTC' : 'ETH'}/USDC ===`)
    console.log(`Wallet: ${wallet.address}`)

    // 1. Approve USDC for BOTH margin leg (trader) AND borrow leg (solver).
    // In the Multipool flow, the Router pulls:
    //   - marginAmount from trader via transferFrom
    //   - borrowAmount from solver via transferFrom
    // Since solver == wallet in our test, we must ensure the router has
    // sufficient allowance for the full notional (margin * leverage).
    const leverage = 5
    const marginAmount = ethers.parseUnits("0.02", 6) // $0.02 USDC margin
    const borrowAmount = marginAmount * BigInt(leverage - 1) // 4x borrow
    const notional = marginAmount + borrowAmount // full 5x notional (0.10 USDC)
    const usdc = new ethers.Contract(USDC, ERC20_ABI, wallet)
    
    const allowance = await usdc.allowance(wallet.address, router.target)
    if (allowance < notional) {
        console.log(`Approving USDC for full notional (margin + borrow = ${ethers.formatUnits(notional, 6)} USDC)...`)
        const tx = await usdc.approve(router.target, ethers.MaxUint256)
        await tx.wait()
        console.log(`✅ Approved`)
    }

    // 2. Prepare swap params
    // For ETH: zeroForOne = false (USDC is token1, we pay token1) -> Long ETH
    // For WBTC: USDC is token0, WBTC is token1. zeroForOne = true (we pay token0) -> Long WBTC
    const zeroForOne = isWbtc ? true : false
    
    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bool", "uint8", "address"],
        [true, leverage, wallet.address] // isLong=true, leverage, trader
    )

    const MIN_PRICE_LIMIT = 4295128739n + 1n;
    const MAX_PRICE_LIMIT = 1461446703485210103287273052203988822378723970342n - 1n;
    const sqrtPriceLimitX96 = zeroForOne ? MIN_PRICE_LIMIT : MAX_PRICE_LIMIT

    const tickSpacing = isWbtc ? 60 : 10
    const fee = isWbtc ? 3000 : 500
    
    // Sort tokens for PoolKey
    const currency0 = isWbtc ? USDC : ETH
    const currency1 = isWbtc ? WBTC : USDC

    const swapParams = {
        key: {
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hookAddr
        },
        standardPoolKey: {
            currency0: currency0,
            currency1: currency1,
            fee: 500,
            tickSpacing: isWbtc ? 60 : 10,
            hooks: ethers.ZeroAddress
        },
        zeroForOne: zeroForOne,
        amountSpecified: -marginAmount, // negative = exact input
        leverage: leverage,
        solver: solverAddr || wallet.address,
        hookData: hookData
    }

    console.log(`\nExecuting Router Swap...`)
    console.log(`Margin: ${ethers.formatUnits(marginAmount, 6)} USDC (${leverage}x leverage, notional: ${ethers.formatUnits(notional, 6)} USDC)`)
    
    try {
        const tx = await router.swapMultiPool(swapParams)
        console.log(`Tx hash: ${tx.hash}`)
        const receipt = await tx.wait()
        console.log(`✅ Position Opened! Gas used: ${receipt.gasUsed.toString()}`)
    } catch (e) {
        console.error(`❌ Transaction failed!`)
        console.error(e.message)
        if (e.data) console.error("Error data:", e.data)
    }
}

main().catch(console.error)
