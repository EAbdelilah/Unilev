import { keccak256, toBytes } from "viem"
import fs from "node:fs"
import path from "node:path"
const target = (process.argv[2] || "0x0").toLowerCase()
const roots = ["out", "lib/v4-core/out", "lib/openzeppelin-contracts/out", "lib/openzeppelin-contracts-upgradeable/out", "cache"]
const hits = []
const seen = new Set()
function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { walk(p); continue }
    if (!e.name.endsWith(".json")) continue
    let j
    try { j = JSON.parse(fs.readFileSync(p, "utf8")) } catch { continue }
    if (!Array.isArray(j.abi)) continue
    for (const it of j.abi) {
      if (it.type !== "error" && it.type !== "revert") continue
      const sig = it.name + "(" + (it.inputs||[]).map(i=>i.type).join(",") + ")"
      if (seen.has(sig)) continue
      seen.add(sig)
      if (keccak256(toBytes(sig)).slice(0,10).toLowerCase() === target) hits.push(sig + "  <- " + p)
    }
  }
}
roots.forEach(walk)
console.log(hits.length ? hits.join("\n") : "NO MATCH for " + target)
