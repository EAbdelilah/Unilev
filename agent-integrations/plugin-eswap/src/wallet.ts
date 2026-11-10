/**
 * Shared internal surface between the action and the provider:
 * runtime-settings resolution and viem clients bound to Base.
 */
import {
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  type Account,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { IAgentRuntime } from "@elizaos/core";
import { DEFAULT_RPC_URL, resolveDeploymentWith, type EswapDeployment } from "./constants.js";

export interface RuntimeEswapSettings {
  readonly deployment: EswapDeployment;
  readonly rpcUrl: string;
}

/** Reads settings from the runtime, falling back to the verified defaults. */
export function readRuntimeSettings(runtime: IAgentRuntime): RuntimeEswapSettings {
  const rpc = runtime.getSetting("BASE_RPC_URL") ?? runtime.getSetting("ESWAP_RPC_URL");
  const rpcUrl = typeof rpc === "string" && rpc.trim().length > 8 ? rpc.trim() : (DEFAULT_RPC_URL as string);
  return {
    deployment: resolveDeploymentWith(
      runtime.getSetting("ESWAP_HOOK_ADDRESS")?.toString(),
      runtime.getSetting("ESWAP_ROUTER_ADDRESS")?.toString(),
    ),
    rpcUrl,
  };
}

/** Creates a read-only client for the configured RPC. */
export function createReadOnlyClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: base, transport: http(rpcUrl) }) as PublicClient;
}

/** Normalizes a private-key setting into a viem local account (0x + 32 bytes). */
function normalizePrivateKey(raw: string): `0x${string}` {
  let value = raw.trim();
  if (!value.startsWith("0x")) {
    value = `0x${value}`;
  }
  if (hexToBytes(value as `0x${string}`).length !== 32) {
    throw new Error("EVM_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return value as `0x${string}`;
}

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
export function createWalletFromRuntime(runtime: IAgentRuntime): WalletHandle {
  const rawKey = runtime.getSetting("EVM_PRIVATE_KEY");
  if (typeof rawKey !== "string" || rawKey.trim().length < 66) {
    throw new Error("Agent runtime is missing a configured EVM wallet: set EVM_PRIVATE_KEY (settings).");
  }
  const account = privateKeyToAccount(normalizePrivateKey(rawKey));
  const settings = readRuntimeSettings(runtime);
  const publicClient = createReadOnlyClient(settings.rpcUrl);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(settings.rpcUrl),
  });
  return {
    account,
    address: account.address,
    walletClient: walletClient as WalletClient,
    publicClient: publicClient as PublicClient,
  };
}
