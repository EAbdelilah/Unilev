const { ethers } = require("ethers")
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") })

const PM = "0x1F98400000000000000000000000000000000004"
const WETH = "0x4200000000000000000000000000000000000006"
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6"
const HOOK = "0x4bd2C1e73d150b65EF88DBa247Ed60A1538310c8"

const provider = new ethers.JsonRpcProvider(process.env.UNICHAIN_RPC_URL)
const abi = ethers.AbiCoder.defaultAbiCoder()
function poolId(c0, c1, fee, ts, h) {
  return ethers.keccak256(abi.encode(["address", "address", "uint24", "int24", "address"], [c0, c1, fee, ts, h]))
}

async function main() {
  const h = await provider.getBlockNumber()
  const pm = new ethers.Contract(PM, [
    "function getSlot0(bytes32) view returns (uint160, int24, uint16, uint24)",
    "function getLiquidity(bytes32) view returns (uint128)",
    "function totalLiquidity(bytes32) view returns (uint256)",
  ], provider)

  const cands = []
  for (const [c0, c1, tag] of [[USDC, WETH, "USDC/WETH"], [WETH, USDC, "WETH/USDC"]]) {
    for (const fee of [100, 300, 500, 3000, 10000, 2500]) {
      for (const ts of [60, 200, 10]) {
        const label = tag + " F" + fee + "/T" + ts
        cands.push([poolId(c0, c1, fee, ts, ethers.ZeroAddress), label])
      }
    }
  }
  for (const [id, label] of cands) {
    try {
      const s0 = await pm.getSlot0(id, { blockTag: h })
      const liq = await pm.getLiquidity(id, { blockTag: h })
      const tl = await pm.totalLiquidity(id, { blockTag: h })
      const p = Number(s0[0]) / 2 ** 96
      console.log(label, "tick=" + s0[1], "liq=" + liq.toString(), "totalLiq=" + tl.toString(), "price=" + (p * p).toFixed(4))
    } catch (e) { /* not initialized */ }
  }

  const ourId = poolId(USDC, WETH, 3000, 60, HOOK)
  try {
    const s0 = await pm.getSlot0(ourId, { blockTag: h })
    const liq = await pm.getLiquidity(ourId, { blockTag: h })
    const tl = await pm.totalLiquidity(ourId, { blockTag: h })
    console.log("OUR-HOOK 3000/60 tick=" + s0[1], "liq=" + liq.toString(), "totalLiq=" + tl.toString())
  } catch (e) { console.log("OUR-HOOK ERR", e.shortMessage || "no data") }
}

main().catch((e) => { console.error(e); process.exit(1) })