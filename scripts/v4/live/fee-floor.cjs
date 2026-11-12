// Computes the real minimum cost of the phase-3 deploy on Base (OP-stack).
// L2 execution fee = gasUsed * (baseFee + priorityFee); L1 data fee is charged separately.
const { ethers } = require("ethers")

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org"
const GAS_PRICE_ORACLE = "0x420000000000000000000000000000000000000F"
const DEPLOYER = "0x518634753C61342298c3E04326056b3Ce596a566"

// gasUsed for phase 3, from phase3-sim.log
const GAS_USED = 52591432n
// sum of runtime bytecode + ctor args of every contract created in phase 3 (approx tx payload)
const PAYLOAD_BYTES = 185000n

const ORA = [
    "function l1BaseFee() view returns (uint256)",
    "function blobBaseFee() view returns (uint256)",
    "function baseFeeScalar() view returns (uint32)",
    "function blobBaseFeeScalar() view returns (uint32)",
    "function decimals() view returns (uint256)",
    "function getL1Fee(bytes) view returns (uint256)",
]

;(async () => {
    const p = new ethers.JsonRpcProvider(RPC)
    const ora = new ethers.Contract(GAS_PRICE_ORACLE, ORA, p)

    const [block, feeData, prio, bal, nonce] = await Promise.all([
        p.getBlock("latest"),
        p.getFeeData(),
        p.send("eth_maxPriorityFeePerGas", []).then((h) => BigInt(h)),
        p.getBalance(DEPLOYER),
        p.getTransactionCount(DEPLOYER),
    ])
    const gasPrice = feeData.gasPrice ?? block.baseFeePerGas
    const baseFee = block.baseFeePerGas

    const [l1Base, blobBase, baseScalar, blobScalar, dec] = await Promise.all([
        ora.l1BaseFee(),
        ora.blobBaseFee(),
        ora.baseFeeScalar(),
        ora.blobBaseFeeScalar(),
        ora.decimals(),
    ])

    // L1 fee for one blob-free calldata payload of PAYLOAD_BYTES
    const payload = "0x" + "00".repeat(Number(PAYLOAD_BYTES))
    const l1Fee = await ora.getL1Fee(payload)

    const fmt = (w) => ethers.formatEther(w)
    const gwei = (w) => ethers.formatUnits(w, "gwei")

    console.log("block                ", block.number)
    console.log("baseFee              ", baseFee.toString(), `(${gwei(baseFee)} gwei)`)
    console.log("eth_gasPrice         ", gasPrice.toString(), `(${gwei(gasPrice)} gwei)`)
    console.log("priority (suggested) ", prio.toString(), `(${gwei(prio)} gwei)`)
    console.log("l1BaseFee            ", l1Base.toString(), `(${gwei(l1Base)} gwei)`)
    console.log("blobBaseFee          ", blobBase.toString())
    console.log("baseFeeScalar        ", baseScalar.toString(), "blobBaseFeeScalar", blobScalar.toString(), "decimals", dec.toString())
    console.log("")
    console.log("deployer balance     ", fmt(bal))
    console.log("deployer nonce       ", nonce)
    console.log("")

    const l2Floor = GAS_USED * baseFee
    const l2Suggested = GAS_USED * gasPrice
    console.log(`gasUsed (phase 3)     ${GAS_USED}`)
    console.log(`L2 floor  (baseFee)   ${fmt(l2Floor)}   <- ${gwei(baseFee)} gwei, priority 0`)
    console.log(`L2 suggested (eth_gasPrice) ${fmt(l2Suggested)}`)
    console.log(`L1 data fee (~${PAYLOAD_BYTES} B) ${fmt(l1Fee)}`)
    console.log("")
    const best = l2Floor + l1Fee
    console.log(`BEST-CASE TOTAL       ${fmt(best)}`)
    console.log(`BALANCE               ${fmt(bal)}`)
    const gap = best - bal
    console.log(`GAP                   ${fmt(gap)}  ${gap > 0n ? "(SHORT)" : "(covered)"}`)
    console.log("")
    // headroom: add 20% on top of the best case
    console.log(`recommended top-up    ${fmt((best * 12n) / 10n - bal)}  (best case +20%, minus balance)`)
})()
