/**
 * Eswap margin quote provider — injects protocol context (0% carry, fill
 * venue status, live open-interest capacity) into the agent's prompt whenever
 * it is evaluating trade decisions.
 */
import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from "@elizaos/core";
import { ESWAP_PAIRS, type EswapPairId } from "./../constants.js";
import { ESWAP_HOOK_ABI } from "./../abis.js";
import { createReadOnlyClient, readRuntimeSettings } from "./../wallet.js";
import { formatRawAmount, poolIdOf } from "./../utils.js";
import { hookPoolKey } from "./../constants.js";
import type { Address } from "viem";

export const eswapQuoteProvider: Provider = {
  name: "eswapMarginQuoteProvider",
  description:
    "Injects current Eswap (Base mainnet) liquidity, fill-venue status and the 0% daily borrow carry comparison " +
    "into the agent's prompt context when it is evaluating trade decisions.",
  dynamic: true,
  position: 1,
  get: async (runtime: IAgentRuntime, _message: Memory, _state: State): Promise<ProviderResult> => {
    const settings = readRuntimeSettings(runtime);
    const client = createReadOnlyClient(settings.rpcUrl);
    const { deployment } = settings;

    const lines: string[] = [];
    lines.push("Eswap margin (Base mainnet, chainId 8453) — 0% daily borrow carry, no funding rate, no continuous interest.");
    lines.push("Pairs: WETH/USDC (live + fill venue configured), WBTC/USDC (hook pool registered; standard fill venue NOT configured yet).");
    lines.push("Protocol fee: flat 0.10% of notional (10 bps), settled into protocolFees. Max leverage shipped here: 5x spot margin.");

    // Live open-interest capacity (best-effort; never block prompt assembly).
    try {
      const cap = await client.readContract({
        address: deployment.hook,
        abi: ESWAP_HOOK_ABI,
        functionName: "openInterestCapacity",
      });
      const [capsActive, poolTvlUsd, totalOiUsd, maxSingleTradeUsd, remainingOiUsd] = cap as readonly [
        boolean,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
      lines.push(
        `Open-interest capacity: capsActive=${capsActive}, poolTvl=${formatRawAmount(poolTvlUsd, 18)} USD, ` +
          `totalOI=${formatRawAmount(totalOiUsd, 18)} USD, maxSingleTrade=${formatRawAmount(maxSingleTradeUsd, 18)} USD, ` +
          `remainingOI=${formatRawAmount(remainingOiUsd, 18)} USD.`,
      );
    } catch (cause) {
      lines.push(
        "Open-interest capacity: unavailable for the configured RPC (non-fatal; quotes can still be fetched on demand).",
      );
    }

    // Fill-venue verification for both pairs (best-effort).
    for (const pairId of ["WETH/USDC", "WBTC/USDC"] as EswapPairId[]) {
      const pair = ESWAP_PAIRS[pairId];
      const key = hookPoolKey(pair, deployment.hook);
      try {
        const std = await client.readContract({
          address: deployment.hook,
          abi: ESWAP_HOOK_ABI,
          functionName: "standardPoolKeys",
          args: [poolIdOf(key)],
        });
        const [c0, c1, fee, ts, hooks] = std as readonly [string, string, number, number, string];
        const configured = c0 !== "0x0000000000000000000000000000000000000000";
        lines.push(
          `${pairId} fill venue: ${configured ? `standard pool ${fee}/${ts} (hooks=${hooks})` : "NOT configured — opens will revert"}.`,
        );
      } catch {
        lines.push(`${pairId} fill venue: check skipped (RPC error).`);
      }
    }

    lines.push(
      "Carry comparison: Eswap charges 0.00%/day interest on the borrow leg (vs. a 12% APR continuous-borrow benchmark " +
        "≈ 0.92 USDC per 400 USDC borrowed over 7 days, illustrative comparison, not an Eswap charge).",
    );
    lines.push(
      "When opening: the agent must self-bond the borrow leg via erc20BorrowEscrow (margin + borrow both from the same " +
        "wallet); the escrowed borrow is refundable via withdrawBorrowEscrow if unused.",
    );

    return {
      text: lines.join("\n"),
      values: {
        eswapChainId: 8453,
        eswapProtocolFeeBps: 10,
        eswapCarryAprBps: 0,
        eswapBenchmarkCarryAprBps: 1200,
        eswapMaxLeverage: 5,
        eswapHookAddress: deployment.hook,
        eswapRouterAddress: deployment.router,
      },
      data: {
        deployment,
        rpcUrl: settings.rpcUrl,
      },
    };
  },
};
