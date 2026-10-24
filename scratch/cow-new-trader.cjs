// Create a fresh external trader for a CoW demand->supply cycle (one position
// slot per (poolId, trader); all older actors are already in PositionAlreadyOpen).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");

const FILE = "eswap-ext-trader3.json";
const p = path.join(os.tmpdir(), FILE);
if (fs.existsSync(p)) {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    console.log(`exists: ${FILE} -> ${j.address}`);
} else {
    const w = ethers.Wallet.createRandom();
    fs.writeFileSync(p, JSON.stringify({ address: w.address, privateKey: w.privateKey }, null, 2), { mode: 0o600 });
    console.log(`created: ${FILE} -> ${w.address}`);
}
