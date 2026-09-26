/**
 * javascript/v4/realApis/registerAggregators.js
 * Post-deploy registration of demand-side aggregators (the step no existing
 * deploy script performed — `setAllowedAggregator` was previously only ever
 * called from tests).
 * =================================================================
 * Reads the verified proxy addresses from demandVenues.js and calls
 * `EswapRouter.setAllowedAggregator(proxy, true)` for each configured venue.
 * Unconfigured venues are reported as PENDING instead of failing the run, so a
 * partial rollout is explicit rather than silent.
 *
 * Usage:
 *   node javascript/v4/realApis/registerAggregators.js --dry-run
 *   node javascript/v4/realApis/registerAggregators.js --confirm
 */
require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });

const { createPublicClient, createWalletClient, http, parseAbi } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { describeDemandVenues } = require("./demandVenues.js");

// Minimal ABI: setAllowedAggregator(address,bool) + allowedAggregators(address).
const ROUTER_ABI = parseAbi([
    "function setAllowedAggregator(address aggregator, bool allowed)",
    "function allowedAggregators(address aggregator) view returns (bool)",
    "function owner() view returns (address)",
]);

function loadEnv(name) {
    const value = process.env[name];
    return value === undefined || value.trim() === "" ? undefined : value.trim();
}

function requireEnv(name) {
    const value = loadEnv(name);
    if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
    return value;
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const confirm = process.argv.includes("--confirm");
    if (!dryRun && !confirm) {
        console.error("Pass --dry-run (report only) or --confirm (send transactions).");
        process.exitCode = 2;
        return;
    }

    const rpcUrl = requireEnv("UNICHAIN_RPC_URL");
    const router = requireEnv("V4_ROUTER_ADDRESS");
    const chain = {
        id: 130,
        name: "Unichain",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [rpcUrl] } },
    };
    const account = privateKeyToAccount(requireEnv("PRIVATE_KEY"));
    const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
    const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

    const owner = await publicClient.readContract({ address: router, abi: ROUTER_ABI, functionName: "owner" });
    if (owner.toLowerCase() !== account.address.toLowerCase()) {
        throw new Error(`Signer ${account.address} is not the router owner (${owner}); cannot whitelist aggregators`);
    }

    const venues = describeDemandVenues();
    const configured = venues.filter((v) => v.configured);
    const pending = venues.filter((v) => !v.configured);

    console.log("DEMAND SIDE — aggregator registration on Unichain\n");
    for (const venue of configured) {
        const already = await publicClient.readContract({
            address: router,
            abi: ROUTER_ABI,
            functionName: "allowedAggregators",
            args: [venue.proxy],
        });
        console.log(`  ${already ? "[ALREADY] " : "[ PENDING]"} ${venue.label.padEnd(16)} ${venue.proxy}`);
        if (already || dryRun) continue;
        const hash = await walletClient.writeContract({
            address: router,
            abi: ROUTER_ABI,
            functionName: "setAllowedAggregator",
            args: [venue.proxy, true],
            account,
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error(`setAllowedAggregator reverted for ${venue.label}: ${hash}`);
        console.log(`               whitelisted -> ${hash}`);
    }
    if (pending.length > 0) {
        console.log("\n  PENDING (no verified proxy address — not whitelisted):");
        for (const venue of pending) {
            const reason = venue.blocked ? venue.blocked : `set ${venue.missing.join(", ")}`;
            console.log(`    ${venue.label.padEnd(16)} ${reason}`);
        }
    }
    console.log(`\n  ${configured.length}/${venues.length} aggregators whitelisted.`);
}

main().catch((err) => {
    console.error(`[registerAggregators] fatal: ${err.message}`);
    process.exitCode = 1;
});
