// GAP-1: drive a REAL protocol action from an unaffiliated third party: a
// counterfactual ERC-4337 smart account (Coinbase Smart Wallet v1.1), whose
// UserOperation is relayed by the PUBLIC Pimlico bundler on Base (EntryPoint v0.6).
// The smart account deposits a solver borrow-escrow on EswapRouter (real state change).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { ethers } = require("ethers");
const { createPublicClient, http, encodeFunctionData, parseAbi } = require("viem");
const { base } = require("viem/chains");
const { privateKeyToAccount } = require("viem/accounts");
const { createBundlerClient, toCoinbaseSmartAccount } = require("viem/account-abstraction");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PIMLICO = process.env.PIMLICO_URL || "https://public.pimlico.io/v2/8453/rpc";
const ROUTER = "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1";
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ESCROW = 1000n; // 0.001 USDC

const ERC20_STR = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function transfer(address,uint256) returns (bool)",
];
const ERC20 = parseAbi(ERC20_STR);
const ROUTER_ABI = parseAbi(["function depositBorrowEscrow(address token, uint256 amount)", "function erc20BorrowEscrow(address,address) view returns (uint256)"]);

const ownerPath = path.join(os.tmpdir(), "eswap-smart-owner.json");
let ownerPk;
if (fs.existsSync(ownerPath)) ownerPk = JSON.parse(fs.readFileSync(ownerPath, "utf8")).privateKey;
else { const w = ethers.Wallet.createRandom(); ownerPk = w.privateKey; fs.writeFileSync(ownerPath, JSON.stringify({ privateKey: ownerPk, address: w.address }, null, 2)); }

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const publicClient = createPublicClient({ chain: base, transport: http(RPC) });
    const owner = privateKeyToAccount(ownerPk);
    const account = await toCoinbaseSmartAccount({ client: publicClient, owners: [owner], version: "1.1" });
    const sa = await account.getAddress();

    console.log("EOA owner            =", owner.address);
    console.log("Smart account (4337) =", sa, "(entryPoint v0.6", account.entryPoint.address + ")");
    console.log("USDC bal / ETH bal   =", (await publicClient.readContract({ address: USDC, abi: ERC20, functionName: "balanceOf", args: [sa] })).toString(),
        "/", (await provider.getBalance(sa)).toString());
    console.log("escrow before        =", (await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "erc20BorrowEscrow", args: [sa, USDC] })).toString());

    const trader2 = new ethers.Wallet(JSON.parse(fs.readFileSync(path.join(os.tmpdir(), "eswap-ext-trader2.json"), "utf8")).privateKey, provider);
    const usdc = new ethers.Contract(USDC, ERC20_STR, provider);

    if (process.env.BROADCAST !== "1") {
        console.log("\n[DRY] set BROADCAST=1 to fund + submit the UserOperation.");
        return;
    }

    // 1. fund the smart account: USDC (margin for escrow) + ETH (gas).
    if ((await usdc.balanceOf(sa)) < ESCROW) {
        const t = await usdc.connect(trader2).transfer(sa, ESCROW);
        console.log("USDC fund tx", t.hash); await t.wait();
    }
    let eth = await provider.getBalance(sa);
    if (eth < 25000000000000n) {
        const t = await trader2.sendTransaction({ to: sa, value: 25000000000000n - eth });
        console.log("ETH fund tx ", t.hash); await t.wait();
    }
    console.log("funded: USDC", (await usdc.balanceOf(sa)).toString(), "ETH", (await provider.getBalance(sa)).toString());

    // 2. build + send the UserOperation via the public bundler
    const calls = [
        { to: USDC, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, ESCROW] }) },
        { to: ROUTER, data: encodeFunctionData({ abi: ROUTER_ABI, functionName: "depositBorrowEscrow", args: [USDC, ESCROW] }) },
    ];
    const bundlerClient = createBundlerClient({ account, client: publicClient, chain: base, transport: http(PIMLICO) });
    const opHash = await bundlerClient.sendUserOperation({ account, calls });
    console.log("\nUserOperation hash   =", opHash);
    const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: opHash });
    console.log("included tx          =", receipt.receipt.transactionHash, "block", receipt.receipt.blockNumber, "success", receipt.success);
    const after = await publicClient.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: "erc20BorrowEscrow", args: [sa, USDC] });
    console.log("escrow after         =", after.toString(), after === ESCROW ? "OK (external bundler relayed a real protocol state change)" : "MISMATCH");
    fs.writeFileSync(path.resolve(process.cwd(), "gap1-4337.json"),
        JSON.stringify({ smartAccount: sa, owner: owner.address, entryPoint: account.entryPoint, opHash, txHash: receipt.receipt.transactionHash, blockNumber: Number(receipt.receipt.blockNumber), escrow: after.toString() }, null, 2));
    console.log("Saved -> gap1-4337.json");
})().catch((e) => { console.error("FAILED:", e.shortMessage || e.message || e); if (e.cause) console.error("cause:", e.cause.shortMessage || e.cause.message); process.exit(1); });
