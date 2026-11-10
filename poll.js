const { ethers } = require("ethers");
const p = new ethers.JsonRpcProvider("https://mainnet.base.org");
const addrs = ["0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037","0x518634753C61342298c3E04326056b3Ce596a566"];
const usdc = new ethers.Contract("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", ["function balanceOf(address) view returns (uint256)"], p);
(async () => {
  for (let i=0;i<5;i++) {
    for (const a of addrs) {
      const e = await p.getBalance(a);
      const u = await usdc.balanceOf(a);
      console.log(new Date().toISOString(), a, "ETH", ethers.formatEther(e), "USDC", ethers.formatUnits(u,6));
    }
    await new Promise(r=>setTimeout(r,10000));
  }
})();
