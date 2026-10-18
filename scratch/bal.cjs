const fs = require("fs"), os = require("os"), path = require("path");
const { ethers } = require("ethers");
require("dotenv").config();
(async () => {
    const p = new ethers.JsonRpcProvider("https://mainnet.base.org");
    const usdc = new ethers.Contract("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ["function balanceOf(address) view returns (uint256)"], p);
    const w = (f) => new ethers.Wallet(JSON.parse(fs.readFileSync(path.join(os.tmpdir(), f), "utf8")).privateKey, p);
    const t = w("eswap-ext-trader2.json");
    const s = w("eswap-ext-solver.json");
    const g = new ethers.Wallet(process.env.PRIVATE_KEY, p);
    console.log("trader", t.address, (await usdc.balanceOf(t.address)).toString());
    console.log("solver", s.address, (await usdc.balanceOf(s.address)).toString());
    console.log("gov   ", g.address, (await usdc.balanceOf(g.address)).toString());
})();
