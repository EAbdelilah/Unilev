// ── Report a landed Base CoW solver-settlement open ──────────────────────────
// Reads the confirmed fill tx + live hook/router state and writes cow-open.json.
//   COW_TX, COW_OWNER, COW_SOLVER, COW_DIGEST, COW_UID
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const USDC = ethers.getAddress("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
const WETH = ethers.getAddress("0x4200000000000000000000000000000000000006");
const HOOK = ethers.getAddress(process.env.V4_HOOK_ADDRESS || "0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8");
const ROUTER = ethers.getAddress(process.env.V4_ROUTER_ADDRESS || "0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1");
const SETTLEMENT = ethers.getAddress(process.env.V4_COW_SETTLEMENT_ADDRESS || "0xD2e8b474d6faB4d879Fe4621192B018B35B79488");

const TX = process.env.COW_TX || "0x1a952bd313e2d924c5a97c8ceaf758710e47d67668d18b332b4fa91378f9699b";
const OWNER = ethers.getAddress(process.env.COW_OWNER || "0x233a579E70c7D689f20f05800f0dB12c3B90aa6C");
const SOLVER = ethers.getAddress(process.env.COW_SOLVER || "0x518634753C61342298c3E04326056b3Ce596a566");
const DIGEST = process.env.COW_DIGEST || "0x6bb76538fcaded8fb06b8839e6d5cfd4e00e602f3475e4acf15f842c12ea28ea";
const UID = process.env.COW_UID || `${DIGEST}${OWNER.slice(2).toLowerCase()}6ad2bb61`;

const ABI = {
    router: ["function erc20BorrowEscrow(address,address) view returns (uint256)", "function registeredSolvers(address) view returns (bool)"],
    hook: [
        "function positions(bytes32,address) view returns (address,uint256,uint256,uint8,bool,uint160,int24,int24,uint128)",
        "function positionSolver(bytes32,address) view returns (address)",
        "function solverDebts(bytes32,address,address) view returns (address,uint256,uint256)",
    ],
    erc20: ["function balanceOf(address) view returns (uint256)"],
};

const idOf = (k) => ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "uint24", "int24", "address"], k));

(async () => {
    const provider = new ethers.JsonRpcProvider(RPC);
    const hookId = idOf([WETH, USDC, 3000, 60, HOOK]);
    const hook = new ethers.Contract(HOOK, ABI.hook, provider);
    const router = new ethers.Contract(ROUTER, ABI.router, provider);
    const usdc = new ethers.Contract(USDC, ABI.erc20, provider);

    const rcpt = await provider.getTransactionReceipt(TX);
    if (!rcpt) throw new Error("receipt not found for " + TX);
    const pos = await hook.positions(hookId, OWNER);
    const debt = await hook.solverDebts(hookId, OWNER, SOLVER);
    const psolver = await hook.positionSolver(hookId, OWNER);

    const artifact = {
        chainId: 8453,
        kind: "cow-solver-settlement-open",
        txHash: TX,
        blockNumber: rcpt.blockNumber,
        gasUsed: rcpt.gasUsed.toString(),
        status: rcpt.status,
        router: ROUTER,
        hook: HOOK,
        settlement: SETTLEMENT,
        hookPoolId: hookId,
        hookPoolKey: [WETH, USDC, 3000, 60, HOOK],
        orderUid: UID,
        digest: DIGEST,
        trader: OWNER,
        solver: SOLVER,
        leverage: Number(pos[3]),
        position: {
            trader: pos[0],
            collateral: pos[1].toString(),
            borrowed: pos[2].toString(),
            leverage: Number(pos[3]),
            isLong: pos[4],
        },
        solverDebt: { solver: debt[0], principal: debt[1].toString(), yieldAccrued: debt[2].toString() },
        positionSolver: psolver,
        solverUsdc: (await usdc.balanceOf(SOLVER)).toString(),
        solverEscrowAfter: (await router.erc20BorrowEscrow(SOLVER, USDC)).toString(),
        reportedAt: new Date().toISOString(),
    };
    const out = path.resolve(process.cwd(), "cow-open.json");
    fs.writeFileSync(out, JSON.stringify(artifact, null, 2));
    console.log(JSON.stringify(artifact, null, 2));
    console.log(`\nSaved -> ${out}`);
})().catch((e) => {
    console.error("FAILED:", e.shortMessage || e.message);
    process.exit(1);
});
