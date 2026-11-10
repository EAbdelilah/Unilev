/**
 * Shared internal surface between the action and the provider:
 * runtime-settings resolution and viem clients bound to Base.
 */
import { type Account, type Address, type PublicClient, type WalletClient } from "viem";
import type { IAgentRuntime } from "@elizaos/core";
import { type EswapDeployment } from "./constants.js";
export interface RuntimeEswapSettings {
    readonly deployment: EswapDeployment;
    readonly rpcUrl: string;
}
/** Reads settings from the runtime, falling back to the verified defaults. */
export declare function readRuntimeSettings(runtime: IAgentRuntime): RuntimeEswapSettings;
/** Creates a read-only client for the configured RPC. */
export declare function createReadOnlyClient(rpcUrl: string): PublicClient;
export interface WalletHandle {
    readonly account: Account;
    readonly address: Address;
    readonly walletClient: WalletClient;
    readonly publicClient: PublicClient;
}
/**
 * Builds a signed-transactor bound to the agent's EVM wallet.
 * Expects runtime settings:
 *   EVM_PRIVATE_KEY (required) — hex private key of the trading EOA
 *   BASE_RPC_URL / ESWAP_RPC_URL — optional RPC override
 */
export declare function createWalletFromRuntime(runtime: IAgentRuntime): WalletHandle;
//# sourceMappingURL=wallet.d.ts.map