const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const target = (process.argv[2] || "0x0564e6be").toLowerCase();
function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (e.name.endsWith(".json")) out.push(p);
    }
}
const files = [];
walk(path.resolve(process.cwd(), "out"), files);
const seen = new Set();
for (const f of files) {
    let j;
    try { j = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    const abi = j.abi || (j.abi === undefined && j.thisVersion ? null : null);
    if (!Array.isArray(abi)) continue;
    for (const item of abi) {
        if (item.type !== "error") continue;
        const sig = `${item.name}(${(item.inputs || []).map((i) => i.type).join(",")})`;
        const sel = ethers.id(sig).slice(0, 10);
        if (sel === target && !seen.has(sig)) { seen.add(sig); console.log(sel, sig, "<-", path.basename(f)); }
    }
}
if (!seen.size) console.log("no ABI error matches", target);
