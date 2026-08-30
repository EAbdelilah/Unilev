/**
 * javascript/v4/closePosition.js
 * Closes an active position on Unichain mainnet.
 * Usage: node javascript/v4/closePosition.js [eth|wbtc]
 */
const { ethers } = require("ethers")
const { setup } = require("./utils")

async function main() {
    const { provider, wallet, router, hookAddr, solverAddr, ETH, USDC, WBTC } = setup()

    const arg = process.argv[2] || "eth"
    const isWbtc = arg.toLowerCase() === "wbtc"

    console.log(`\n=== Closing Position on ${isWbtc ? 'WBTC' : 'ETH'}/USDC ===`)
    console.log(`Wallet: ${wallet.address}`)

    const tickSpacing = isWbtc ? 60 : 10
    const fee = isWbtc ? 3000 : 500
    const currency0 = isWbtc ? USDC : ETH
    const currency1 = isWbtc ? WBTC : USDC

    const poolKey = {
        currency0: currency0,
        currency1: currency1,
        fee: fee,
        tickSpacing: tickSpacing,
        hooks: hookAddr
    }

    const minAmountOut = 0n // min net payout to trader

    console.log("Calling router.closePosition...")
    try {
        const tx = await router.closePosition(
            hookAddr,
            poolKey,
            wallet.address,
            solverAddr || wallet.address,
            minAmountOut
        )
        console.log(`Tx hash: ${tx.hash}`)
        const receipt = await tx.wait()
        console.log(`✅ Position Closed Successfully! Gas used: ${receipt.gasUsed.toString()}`)
    } catch (e) {
        console.error(`❌ Close transaction failed!`)
        console.error(e.message)
        if (e.data) console.error("Error data:", e.data)
    }
}

main().catch(console.error)
