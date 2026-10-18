require("dotenv").config();
const { ethers } = require("ethers");
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
(async () => {
    const to = process.env.FUND_TO;
    const wei = BigInt(process.env.FUND_WEI || "0");
    if (!to || wei <= 0n) throw new Error("set FUND_TO and FUND_WEI");
    const p = new ethers.JsonRpcProvider(RPC);
    const deployer = new ethers.Wallet(process.env.PRIVATE_KEY, p);
    const bal = await p.getBalance(deployer.address);
    console.log("deployer", deployer.address, "bal", bal.toString());
    // leave 300k gas worth for our own tx
    const fee = await p.getFeeData();
    const cost = (fee.maxFeePerGas || fee.gasPrice || 10000000n) * 21000n;
    if (bal < wei + cost) throw new Error(`deployer too low: have ${bal} need ${wei + cost}`);
    const tx = await deployer.sendTransaction({ to, value: wei });
    console.log("tx", tx.hash);
    const r = await tx.wait();
    console.log("status", r.status, "gas", r.gasUsed.toString());
    console.log("to bal after", (await p.getBalance(to)).toString());
})().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
