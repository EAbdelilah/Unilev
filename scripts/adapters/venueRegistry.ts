/**
 * scripts/adapters/venueRegistry.ts
 * Supply-side venue readiness report + explicit-venue router.
 * =================================================================
 * CLI over the venue registry (`scripts/venues/`). With no arguments it prints
 * the readiness of every registered solver network — which venues are
 * routable right now, and exactly which env slot is missing for the rest.
 *
 * The supply side is the top of the stack:
 *
 *   [ SUPPLY: SOLVER NETWORKS ]  CoW · UniswapX · Across · 1inch Fusion
 *   [ DEMAND: AGGREGATORS   ]  Enso · Odos · Bungee · Jumper · 1inch
 *
 * Aggregators are venue-agnostic on-chain (the router whitelists a proxy and
 * executes opaque calldata), so this report covers the supply side, which is
 * where per-venue state actually lives.
 *
 * Usage:
 *   npm run venues:report            # readiness of every venue (no RPC needed)
 *   npm run venues:report -- --route cow --route-mode orderbook <intent.json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describeAllVenues } from "../lib/venueConfig.js";
import { SUPPLY_VENUE_IDS, type SupplyVenueId, type VenueRoute } from "../lib/venues.js";
import { SupplyVenueRegistry } from "../venues/index.js";
import type { LeverageIntent } from "../lib/types.js";

function parseArgs(argv: readonly string[]): { route?: SupplyVenueId; mode: VenueRoute; intentPath?: string } {
    let route: SupplyVenueId | undefined;
    let mode: VenueRoute = "orderbook";
    let intentPath: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === undefined) continue;
        if (arg === "--route") {
            const value = argv[++i];
            if (value === undefined || !isSupplyVenueId(value)) {
                throw new Error(`--route must be one of: ${SUPPLY_VENUE_IDS.join(", ")}`);
            }
            route = value;
        } else if (arg === "--route-mode") {
            const value = argv[++i];
            if (value !== "orderbook" && value !== "direct") {
                throw new Error(`--route-mode must be "orderbook" or "direct", got ${value}`);
            }
            mode = value;
        } else if (arg === "--intent") {
            const value = argv[++i];
            if (value === undefined) throw new Error("--intent requires a path to a JSON file");
            intentPath = value;
        } else {
            throw new Error(`unknown argument: ${arg}`);
        }
    }
    return route === undefined ? { mode, ...(intentPath === undefined ? {} : { intentPath }) } : { route, mode, ...(intentPath === undefined ? {} : { intentPath }) };
}

function isSupplyVenueId(value: string): value is SupplyVenueId {
    return (SUPPLY_VENUE_IDS as readonly string[]).includes(value);
}

/** Loads a `LeverageIntent` from JSON, coercing decimal strings to bigint. */
function loadIntent(path: string): LeverageIntent {
    const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as Record<string, unknown>;
    const num = (key: string): bigint => {
        const v = raw[key];
        if (typeof v !== "string" && typeof v !== "number") {
            throw new Error(`intent.${key} must be a decimal string or number`);
        }
        return BigInt(v);
    };
    const str = (key: string): string => {
        const v = raw[key];
        if (typeof v !== "string") throw new Error(`intent.${key} must be a string`);
        return v;
    };
    return {
        originChainId: Number(raw.originChainId),
        tokenIn: str("tokenIn") as `0x${string}`,
        tokenOut: str("tokenOut") as `0x${string}`,
        fee: Number(raw.fee),
        leverage: Number(raw.leverage),
        amountIn: num("amountIn"),
        minAmountOut: num("minAmountOut"),
        recipient: str("recipient") as `0x${string}`,
        owner: str("owner") as `0x${string}`,
        signature: str("signature") as `0x${string}`,
        signingScheme: str("signingScheme") as LeverageIntent["signingScheme"],
    };
}

function printReadiness(): void {
    const rows = describeAllVenues();
    const width = Math.max(...rows.map((r) => r.label.length));
    console.log("SUPPLY SIDE — registered solver networks\n");
    console.log("  Settlers are only interchangeable when they share a settlement model.");
    console.log("  erc7683-fill is served by EswapSettlement; the others need their own settler.\n");
    for (const row of rows) {
        const status = row.configured ? "ROUTABLE" : "PENDING  ";
        console.log(`  [${status}] ${row.label.padEnd(width)}  ${row.settlementModel.padEnd(16)} settler=${row.settler.padEnd(8)} ${row.settlement ?? "(no settlement)"}`);
        if (row.settler === "missing") {
            console.log(`             BLOCKED: no settler speaks ${row.settlementModel}; this venue cannot fill until one is deployed + whitelisted.`);
        }
        if (!row.configured) {
            console.log(`             missing: ${row.missing.join(", ")}`);
            console.log(`             docs:    ${row.docs}`);
        }
    }
    const ready = rows.filter((r) => r.configured && r.settler === "wired");
    const fillable = rows.filter((r) => r.settler === "wired");
    console.log(`\n  ${ready.length}/${rows.length} venues routable.`);
    console.log(`  ${fillable.length}/${rows.length} venues have a settler that can actually execute a fill.`);
    if (ready.length < rows.length) {
        console.log("  Unconfigured venues REFUSE to route — set the env slots above to enable them.");
    }
    const blocked = rows.filter((r) => r.settler === "missing");
    if (blocked.length > 0) {
        console.log(`  No settler yet for: ${blocked.map((r) => `${r.label} (${r.settlementModel})`).join(", ")}`);
    }
}

async function main(): Promise<void> {
    const { route, mode, intentPath } = parseArgs(process.argv.slice(2));
    if (route === undefined) {
        printReadiness();
        return;
    }
    if (intentPath === undefined) {
        throw new Error("--route requires --intent <path-to-intent.json>");
    }
    const registry = SupplyVenueRegistry.fromEnv();
    const intent = loadIntent(intentPath);
    const result = await registry.route(route, intent, mode);
    console.log(`[venues] ${result.venue} route=${result.route} reference=${result.reference}`);
    if (result.tx !== undefined) console.log(`[venues] tx=${result.tx}`);
    if (result.apiResponse !== undefined) console.log(`[venues] orderbook=${result.apiResponse}`);
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isEntry) {
    main().catch((err: unknown) => {
        console.error(`[venues] fatal: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}
