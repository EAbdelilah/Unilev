import {
    BASE_CHAIN_ID,
    ESWAP_CONTRACTS,
    LEVERAGE,
    PAIRS,
    PROTOCOL_FEE_BPS,
    loadEswapEnv,
} from "@eswap/core";
import { GameWorker } from "@virtuals-protocol/game";
import { createEswapGameFunctions, type EswapGameFunctionOptions } from "./functions.js";

export interface EswapGamePluginOptions extends EswapGameFunctionOptions {}

/**
 * Virtuals G.A.M.E. plugin exposing Eswap 5x 0%-interest spot margin to autonomous agents.
 * Attach `plugin.getWorker()` to any `GameAgent` via `new GameAgent(key, { workers: [...] })`.
 */
export class EswapGamePlugin {
    readonly readOnly: boolean;
    private readonly functions: ReturnType<typeof createEswapGameFunctions>;

    constructor(options: EswapGamePluginOptions = {}) {
        loadEswapEnv();
        this.readOnly = options.readOnly ?? false;
        this.functions = createEswapGameFunctions(options);
    }

    getWorker(): GameWorker {
        return new GameWorker({
            id: "eswap_spot_margin_worker",
            name: "Eswap Spot Margin",
            description:
                "Quotes and opens 5x spot margin longs on Base with 0% borrow interest, 0 TVL and JIT solver capital. Supports WETH/USDC and cbBTC/USDC.",
            functions: [this.functions.quote, this.functions.open],
            getEnvironment: async () => ({
                chain: "base",
                chainId: BASE_CHAIN_ID,
                leverage: LEVERAGE,
                protocolFeeBps: PROTOCOL_FEE_BPS,
                borrowCarryAprPercent: 0,
                tvl: 0,
                capitalModel: "external JIT solver escrow",
                readOnly: this.readOnly,
                pairs: Object.keys(PAIRS),
                contracts: ESWAP_CONTRACTS,
            }),
        });
    }
}
