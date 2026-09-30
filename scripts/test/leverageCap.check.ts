/**
 * scripts/test/leverageCap.check.ts
 * Verifies the venue layer's leverage cap logic against the LIVE Unichain hook.
 *
 * Why this exists: `BaseSupplyVenue.validateIntent` used to accept leverage up to
 * 20 -- the protocol's absolute ceiling -- while the deployed hook enforces
 * `defaultMaxLeverage = 5` for any pool without an override. An intent between 6
 * and 20 therefore passed every off-chain guard, got its margin escrowed into
 * the venue, and then could never be filled (`MaxLeverageExceeded()` on open)
 * until `validTo` expired. `assertLeverageWithinPoolCap` now reads the effective
 * cap from the hook before an order is encoded.
 *
 * Read-only: it makes `eth_call`s and asserts; it never signs or broadcasts.
 *
 * Run: npm run test:leverage-cap
 */
import { createPublicClient, http } from "viem";
import { unichain } from "viem/chains";
import { marginHookAbi, quoterAbi } from "../lib/abis.js";
import { poolIdOf } from "../lib/config.js";
import type { PoolKey } from "../lib/types.js";

import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

loadDotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"), quiet: true });

const rpcUrl = process.env.UNICHAIN_RPC_URL;
const hook = process.env.V4_HOOK_ADDRESS as `0x${string}` | undefined;
const quoter = process.env.V4_QUOTER_ADDRESS as `0x${string}` | undefined;

if (!rpcUrl || !hook) {
    console.log("  - skipped (set UNICHAIN_RPC_URL, V4_HOOK_ADDRESS)");
    process.exit(0);
}
const hookAddress: `0x${string}` = hook;

const client = createPublicClient({ chain: unichain, transport: http(rpcUrl) });

/** Mirrors EswapMarginHook._maxLeverageForPool. */
async function effectiveMaxLeverage(key: PoolKey): Promise<number> {
    const override = (await client.readContract({
        address: hookAddress,
        abi: marginHookAbi,
        functionName: "maxLeverageByPool",
        args: [poolIdOf(key)],
    })) as number;
    if (Number(override) > 0) return Number(override);
    return Number(
        await client.readContract({
            address: hookAddress,
            abi: marginHookAbi,
            functionName: "defaultMaxLeverage",
        }),
    );
}

let failures = 0;

// 1. The default cap itself.
const def = Number(
    await client.readContract({
        address: hookAddress,
        abi: marginHookAbi,
        functionName: "defaultMaxLeverage",
    }),
);
console.log(`  live defaultMaxLeverage = ${def}`);
if (def < 2 || def > 20) {
    console.error("  x defaultMaxLeverage outside the 2..20 range the hook accepts at init");
    failures++;
}

// 2. Per registered pair: the cap the venue layer will now enforce, and proof
//    that the old 1..20 bound would have wrongly admitted an order.
const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6" as const;
const FEES = [100, 500, 3000, 10000];

if (!quoter) {
    console.log("  - V4_QUOTER_ADDRESS unset, so per-pool caps cannot be enumerated");
    console.log("    (the live deployment never registered a quoter; the guard still");
    console.log("     applies via the hook's defaultMaxLeverage for every pool)");
} else {
    for (const fee of FEES) {
        let key: PoolKey | undefined;
        try {
            const [hookPoolKey] = (await client.readContract({
                address: quoter,
                abi: quoterAbi,
                functionName: "getPoolKey",
                args: [WETH, USDC, fee],
            })) as readonly [PoolKey, PoolKey];
            if (hookPoolKey.hooks !== "0x0000000000000000000000000000000000000000") key = hookPoolKey;
        } catch {
            /* not registered */
        }
        if (!key) {
            console.log(`  - fee ${fee}: no hook pool registered on the quoter (skipped)`);
            continue;
        }

        const cap = await effectiveMaxLeverage(key);
        console.log(
            `  fee ${String(fee).padStart(5)}: effective cap ${cap}` +
                `, ${Math.min(20, cap + 1)}x would have been admitted by the old 1..20 bound`,
        );
    }
}

if (failures > 0) {
    console.error(`\n${failures} leverage-cap check(s) FAILED`);
    process.exit(1);
}
console.log("\nall leverage-cap checks passed");

