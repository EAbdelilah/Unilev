/**
 * javascript/v4/setFees.js
 * One-time fee configuration: sets protocol fee (reserveFactor) to 5 bps.
 * Run ONCE:
 *   node javascript/v4/setFees.js
 */
const { ethers } = require("ethers")
const { setup } = require("./utils")

async function main() {
    const { provider, wallet, hook, hookAddr } = setup()

    console.log(`\n${"═".repeat(58)}`)
    console.log(`  Fee Configuration`)
    console.log(`  Owner : ${wallet.address}`)
    console.log(`  Hook  : ${hookAddr}`)
    console.log(`${"═".repeat(58)}\n`)

    const owner = await hook.owner()
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        console.error(`❌  Caller is not hook owner. Owner=${owner}`)
        process.exit(1)
    }
    console.log(`✅  Caller is hook owner`)

    const currentReserve = await hook.reserveFactor()
    console.log(`\nCurrent reserveFactor: ${currentReserve} bps`)

    if (currentReserve === 5n) {
        console.log(`✅  reserveFactor already 5 bps — nothing to do`)
        return
    }

    const currentRouter = await hook.router()
    const currentSwing = await hook.maxPriceSwingBps()
    const currentLev = await hook.defaultMaxLeverage()
    const currentTwap = await hook.requireTwapOracle()

    const TARGET_RESERVE = 5

    console.log(`\n🔧  Setting reserveFactor to ${TARGET_RESERVE} bps…`)
    console.log(`    (preserving router=${currentRouter}, swing=${currentSwing}, lev=${currentLev}, twap=${currentTwap})`)

    const tx = await hook.setConfig({
        treasury: wallet.address,
        router: currentRouter,
        reserveFactor: TARGET_RESERVE,
        maxPriceSwingBps: currentSwing,
        defaultMaxLeverage: currentLev,
        requireTwapOracle: currentTwap,
    })
    console.log(`    Tx: ${tx.hash}`)
    await tx.wait()

    const newReserve = await hook.reserveFactor()
    console.log(`    ✅  reserveFactor = ${newReserve} bps`)

    const feeFor = await hook.protocolFeeFor(wallet.address)
    console.log(`    protocolFeeFor(deployer) = ${feeFor} bps`)
    console.log(`\n✅  Fee configuration complete.\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
