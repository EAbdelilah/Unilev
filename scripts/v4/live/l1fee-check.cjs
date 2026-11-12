// Cross-checks the L1 data fee that Base charges on top of gasUsed*gasPrice,
// using real contract-creation receipts (OP-stack receipts expose l1Fee).
const { ethers } = require("ethers")

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org"

;(async () => {
    const p = new ethers.JsonRpcProvider(RPC)
    const latest = await p.getBlockNumber()

    const found = []
    for (let n = latest; n > latest - 40 && found.length < 6; n--) {
        const b = await p.getBlock(n, true)
        if (!b) continue
        for (const tx of b.prefixedTransactions || b.transactions) {
            if (typeof tx === "string") continue
            if (tx.to !== null) continue // contract creation only
            found.push(tx)
            if (found.length >= 6) break
        }
    }

    if (!found.length) {
        console.log("no contract creations found in the last 40 blocks")
        return
    }

    console.log("L1 data fee on real Base contract creations (blob-posting era):")
    let perByte = 0n
    let n = 0
    for (const tx of found) {
        const r = await p.getTransactionReceipt(tx.hash)
        const l1 = r.l1Fee ?? 0n
        const l2 = (r.gasUsed * r.gasPrice)
        const size = (tx.data.length - 2) / 2
        const rate = size ? (l1 * 1000n) / BigInt(size) : 0n
        perByte += rate
        n++
        console.log(
            `  ${tx.hash.slice(0, 12)}… size=${String(size).padStart(6)}B gas=${String(r.gasUsed).padStart(9)} ` +
                `L2=${ethers.formatEther(l2).slice(0, 12)} L1=${ethers.formatEther(l1).slice(0, 12)} ` +
                `(L1=${((Number(l1) / Number(l2)) * 100).toFixed(1)}% of L2, ${Number(rate) / 1000} wei/byte)`
        )
    }
    const avgRate = perByte / BigInt(n) // wei per byte * 1000
    const bytes = 185000n
    const est = (avgRate * bytes) / 1000n
    console.log("")
    console.log(`avg L1 rate        ${Number(avgRate) / 1000} wei/byte`)
    console.log(`L1 fee for 185000B ${ethers.formatEther(est)}`)
    console.log(`L2 at 0.006 gwei   0.00031554909`)
    console.log(`TOTAL ESTIMATE     ${ethers.formatEther(315549090000000n + est)}`)
    console.log(`BALANCE            0.000348548422490396`)
    const total = 315549090000000n + est
    const bal = 348548422490396n
    console.log(`MARGIN             ${ethers.formatEther(bal - total)} (${((Number(bal - total) / Number(bal)) * 100).toFixed(1)}% of balance)`)
})()
