/**
 * scripts/venues/index.ts
 * Supply-side venue registry factory.
 * =================================================================
 * Wires the four registered solver networks (CoW, UniswapX, Across, 1inch
 * Fusion) behind the venue-neutral `SupplyVenue` contract, using env-driven
 * config. Unconfigured venues are still registered so readiness reporting can
 * show them as PENDING, but they refuse to route.
 */
import { loadNetworkConfig, createClients, type ChainClients, type NetworkConfig } from "../lib/config.js";
import { loadVenueConfigs, describeAllVenues } from "../lib/venueConfig.js";
import type { SupplyVenue, SupplyVenueId, VenueRoute, VenueDeps } from "../lib/venues.js";
import { CowVenue } from "./cowVenue.js";
import { UniswapXVenue } from "./uniswapXVenue.js";
import { AcrossVenue } from "./acrossVenue.js";
import { OneInchFusionVenue } from "./oneInchFusionVenue.js";

export class SupplyVenueRegistry {
    private readonly venues: Map<SupplyVenueId, SupplyVenue<any>>;

    constructor(venues: SupplyVenue<any>[]) {
        this.venues = new Map(venues.map((v) => [v.info.id, v]));
    }

    /** Builds every registered venue from the current environment. */
    static fromEnv(): SupplyVenueRegistry {
        const cfg = loadNetworkConfig();
        const clients = createClients(cfg, resolveBridgeKey());
        const deps: VenueDeps = { cfg, clients };
        const venueCfgs = loadVenueConfigs();
        const need = (id: SupplyVenueId) => {
            const c = venueCfgs.get(id);
            if (c === undefined) throw new Error(`no config for venue ${id}`);
            return c;
        };
        return new SupplyVenueRegistry([
            new CowVenue(deps, need("cow")),
            new UniswapXVenue(deps, need("uniswapx")),
            new AcrossVenue(deps, need("across")),
            new OneInchFusionVenue(deps, need("oneinchfusion")),
        ]);
    }

    /** Every registered venue, in registry order. */
    list(): SupplyVenue<any>[] {
        return [...this.venues.values()];
    }

    /** One venue by id; throws if unknown. */
    get(id: SupplyVenueId): SupplyVenue<any> {
        const venue = this.venues.get(id);
        if (venue === undefined) throw new Error(`unknown supply venue: ${id}`);
        return venue;
    }

    /** Venues that are actually routable given the current env. */
    configured(): SupplyVenue<any>[] {
        return this.list().filter((v) => v.info.configured);
    }

    /** Readiness view of every registered venue (configured or PENDING). */
    readiness(): ReturnType<typeof describeAllVenues> {
        return this.list().map((v) => v.info);
    }

    /**
     * Routes an intent to an explicit venue. Throws when that venue is not
     * configured, so a missing address fails loudly instead of silently
     * falling through to an unintended solver network.
     */
    async route(id: SupplyVenueId, intent: Parameters<SupplyVenue<any>["handle"]>[0], route: VenueRoute) {
        return this.get(id).handle(intent, route);
    }
}

function resolveBridgeKey(): string {
    const key = process.env.BRIDGE_PRIVATE_KEY ?? process.env.SOLVER_PRIVATE_KEY;
    if (key === undefined || key.trim() === "") {
        throw new Error("Missing BRIDGE_PRIVATE_KEY (or SOLVER_PRIVATE_KEY)");
    }
    return key.trim();
}

export type { ChainClients, NetworkConfig, SupplyVenue, SupplyVenueId, VenueRoute };
export { describeAllVenues };
