// Widen lib/v4-core's PoolManager pragma so the whole project can build with
// solc 0.8.27.
//
// Why: lib/v4-core@v4.0.0 hard-pins `pragma solidity 0.8.26;` in PoolManager.sol,
// while src/v4 requires 0.8.27 (0.8.26 hits a solc internal compiler error under
// the optimizer, and stack-too-deep without it). A single global `solc` pin can
// therefore never satisfy both.
//
// Idempotent, in-repo patch so fresh clones and CI build without maintaining a
// fork of v4-core. Run before any `forge build`/`forge test`.
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "lib", "v4-core", "src", "PoolManager.sol");

if (!fs.existsSync(file)) {
    console.error(`patch-v4-core: ${file} not found (run: git submodule update --init --recursive)`);
    process.exit(1);
}

const src = fs.readFileSync(file, "utf8");
const out = src.replace(/^pragma solidity 0\.8\.26;/m, "pragma solidity ^0.8.26;");

if (out !== src) fs.writeFileSync(file, out);

console.log("patch-v4-core: PoolManager pragma ready (^0.8.26)");
