/**
 * javascript/v4/openShort.js
 * Opens a LIVE Short position on Unichain mainnet.
 * Usage: node javascript/v4/openShort.js [eth|wbtc]
 *
 * SHORT ETH  = pay ETH (currency0), receive USDC (currency1) → zeroForOne = true
 * SHORT WBTC = pay WBTC (currency1 in USDC/WBTC pool), receive USDC (currency0) → zeroForOne = false
 */
const { ethers } = require("ethers")
const { setup, ERC20_ABI } = require("./utils")

async function main() {
    const { provider, wallet, router, hookAddr, solverAddr, ETH, USDC, WBTC } = setup()

    const arg = process.argv[2] || "eth"
    const isWbtc = arg.toLowerCase() === "wbtc"

    console.log(`\n=== Opening SHORT on ${isWbtc ? 'WBTC' : 'ETH'}/USDC ===`)
    console.log(`Wallet: ${wallet.address}`)

    // Leverage — 5x
    const leverage = 5

    // 1. Set margin and approve
    let marginAmount
    let msgValue = 0n

    if (isWbtc) {
        // WBTC short: pay WBTC (currency1), receive USDC. zeroForOne = false.
        // Router pulls margin + borrow from solver via transferFrom (ERC20).
        marginAmount = ethers.parseUnits("0.00000062", 8) // ~$0.05 at ~$80k/BTC
        const borrowAmount = marginAmount * BigInt(leverage - 1)
        const notional = marginAmount + borrowAmount
        const wbtc = new ethers.Contract(WBTC, ERC20_ABI, wallet)
        const allowance = await wbtc.allowance(wallet.address, router.target)
        if (allowance < notional) {
            console.log(`Approving WBTC for full notional...`)
            const tx = await wbtc.approve(router.target, ethers.MaxUint256)
            await tx.wait()
            console.log(`✅ Approved`)
        }
    } else {
        // ETH short: pay ETH (currency0), receive USDC. zeroForOne = true.
        // For native input the Router requires msg.value == full notional (margin + borrow).
        marginAmount = ethers.parseEther("0.000008") // ~$0.02 ETH at ~$2500
        const borrowAmount = marginAmount * BigInt(leverage - 1) // 4x borrow
        msgValue = marginAmount + borrowAmount // full 5x notional as msg.value (0.00004 ETH)
        console.log(`ETH margin:  ${ethers.formatEther(marginAmount)} ETH`)
        console.log(`ETH notional (msg.value): ${ethers.formatEther(msgValue)} ETH`)
    }

    // 2. Prepare swap params
    const zeroForOne = isWbtc ? false : true

    const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bool", "uint8", "address"],
        [true, leverage, wallet.address] // isMargin=true, leverage, trader
    )

    const tickSpacing = isWbtc ? 60 : 10
    const fee = isWbtc ? 3000 : 500
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
    console.log(`Short margin: ${isWbtc ? ethers.formatUnits(marginAmount, 8) + ' WBTC' : ethers.formatEther(marginAmount) + ' ETH'} (${leverage}x leverage)`)

    try {
        const tx = await router.swapMultiPool(swapParams, { value: msgValue })
        console.log(`Tx hash: ${tx.hash}`)
        const receipt = await tx.wait()
        console.log(`✅ Short Position Opened! Gas used: ${receipt.gasUsed.toString()}`)
    } catch (e) {
        console.error(`❌ Transaction failed!`)
        console.error(e.message)
        if (e.data) console.error("Error data:", e.data)
    }
}

main().catch(console.error)
