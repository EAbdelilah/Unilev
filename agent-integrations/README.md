# Eswap Agent Integration Package

Agent integrations for **Eswap** — a 5x spot margin primitive on Base mainnet
built on Uniswap v4 hooks (EIP-1153 transient storage). Drop-in packages:

| Package | Framework | Entry point |
| --- | --- | --- |
| `@eswap/core` | Framework-agnostic viem v2 | `createEswapClient()`, `getEswapQuote()`, `executeEswapMargin()`; subpaths `./adapters`, `./automation`, `./rebalancer` |
| `@eswap/mcp-server` | Model Context Protocol (Claude/Cursor/Shinkai/OKX) | `npx @eswap/mcp-server` (stdio or HTTP) |
| `@eswap/game-plugin` | Virtuals Protocol G.A.M.E. | `new EswapGamePlugin().getWorker()` |
| `@eswap/agentkit-action-provider` | Coinbase AgentKit (`@coinbase/agentkit`) | `eswapActionProvider()` |
| `@eswap/plugin-margin` | ElizaOS (`@elizaos/core`) | `eswapPlugin` |

All packages target the **current** deployment: hook
`0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8`, router
`0x5b226aE5158de86f1E616875dBab886870B9aAd9`, with `WETH/USDC` fully live and `cbBTC/USDC` in
phase 1. Eswap is a pure JIT solver architecture: 0% interest, 0 TVL, 0 CAC — no ERC-4626 vault
model. See each package README for configuration snippets.

**Protocol facts (Base mainnet, `chainId: 8453`)**

- Hook (margin/accounting pool): `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8`
- Router (entrypoint): `0x5b226aE5158de86f1E616875dBab886870B9aAd9`
- RouterExt (trigger orders / ERC-7683): `0x907CdA8c588c9C859A6fB4F105593a64599741CB`
- PoolManager: `0x498581fF718922c3f8e6A244956aF099B2652b2b`
- Hook pool key: `[currency0, currency1, 3000, 60, hook]`; deep fill pool `[currency0, currency1, 500, 10, 0x…0]`
- `currency0 < currency1`: WETH for WETH/USDC, **USDC for cbBTC/USDC** (inverted stop direction)
- Carry: **0.00% borrow interest**. The 4x borrow leg is JIT-bonded per trade in
  `EswapRouter.erc20BorrowEscrow` by a solver (or self-bonded by the caller); no idle pool exists.
- Protocol fee: **10 bps** on the bought base-token leg, charged on each open/rebalance.

> **cbBTC phase gate (2026-11-18):** pools, Chainlink feed, adapter, quoter and timelock queue are
> live, but hook registration executes at ETA `1795195136` (`2026-11-20 17:18:56 UTC`). Until then
> quotes return `QUOTE_FAILED` and no cbBTC trade should be attempted. WETH/USDC is fully live.

## Universal aggregator, automation & rebalancer suite

`@eswap/core` exposes three public subpaths used by partner integrations:

```ts
import { buildEnsoShortcut, buildContangoQuote, buildUniDexRoute } from "@eswap/core/adapters";
import { createGelatoWeb3Function, buildTriggerOrderTypedData } from "@eswap/core/automation";
import { calculateLeverageTokenMath, buildLifiMarginZap } from "@eswap/core/rebalancer";
```

- **Adapters** build viem-valid calldata for Enso Shortcuts (`/api/v1/shortcuts/route`), Contango
  cPerp-style normalized quotes with a caller-injected Aave/Morpho APR, and UniDex routes with a
  15-minute deadline, slippage floor and capped partner fee.
- **Automation** evaluates Gelato `canExec` from a Chainlink/slot0 price source, builds EIP-712
  trigger-order arm payloads, and schedules recurring 5x DCA opens. `closePosition` stays
  trader-only; keepers use permissionless `executeTriggerOrder` or `liquidate`.
- **Rebalancer** maps 2x/3x/5x leverage-token targets onto Eswap's fixed 5x venue using `L/5` margin
  plus `1-L/5` cash, and encodes LI.FI `contractCalls` / ERC-7683 `EswapSettlement.fill` intents.

Governance-ready partner dossiers:
[`docs/integrations/CONTANGO_INTEGRATION_SPEC.md`](../docs/integrations/CONTANGO_INTEGRATION_SPEC.md),
[`ENSO_SHORTCUT_REGISTRATION.md`](../docs/integrations/ENSO_SHORTCUT_REGISTRATION.md),
[`INDEX_COOP_ZERO_CARRY_TOKENS.md`](../docs/integrations/INDEX_COOP_ZERO_CARRY_TOKENS.md),
[`GELATO_AUTOMATION_GUIDE.md`](../docs/integrations/GELATO_AUTOMATION_GUIDE.md).
No partner listing, Enso registration, Index Coop token or Gelato task is claimed as live.

## AgentKit — fewer than 5 lines

```ts
import { AgentKit } from "@coinbase/agentkit";
import { eswapActionProvider } from "@eswap/agentkit-action-provider";

const agentkit = await AgentKit.from({
  walletProvider,
  actionProviders: [eswapActionProvider()], // get_eswap_margin_quote, open_spot_margin
});
```

Actions shipped:
- `get_eswap_margin_quote` — read-only `eth_call` via `router.quoteExactInput` (+ `hook.quoteOpenFit` size gates), reports expected fill, the 0.10% fee, and estimated 7-day carry savings vs. a 12% APR benchmark.
- `open_spot_margin` — approves USDC, self-bonds the borrow leg into `erc20BorrowEscrow`, then executes `router.swapMultiPool` with a quote-derived `minAmountOut` slippage guard and 15-minute deadline. Returns the BaseScan transaction hash.

Network safety: `supportsNetwork` returns `true` only on Base (`chainId: 8453` or `networkId: base-mainnet`).

## ElizaOS — fewer than 5 lines

```ts
import { AgentRuntime } from "@elizaos/core";
import { eswapPlugin } from "@eswap/plugin-margin";

const agent = new AgentRuntime({ character, plugins: [eswapPlugin], ... });
```

Plugin definition (exactly as specified):

```ts
export const eswapPlugin: Plugin = {
  name: "eswap-margin",
  description: "0% Interest Spot Leverage via Uniswap v4 Hooks on Base",
  actions: [openMarginAction],     // name: EXECUTE_ESWAP_MARGIN
  providers: [eswapQuoteProvider], // liquidity + 0% carry comparison context
  evaluators: [],
};
```

Action: `EXECUTE_ESWAP_MARGIN` (similes: `OPEN_SPOT_LEVERAGE`, `ZERO_CARRY_MARGIN`, `ESWAP_5X_LONG`).

Provider: injects current Eswap liquidity, fill-venue status and the 0% carry
comparison into the agent's prompt context whenever it is evaluating trade decisions.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `ESWAP_HOOK_ADDRESS` | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` | Hook contract (override on redeploy) |
| `ESWAP_ROUTER_ADDRESS` | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` | Router entrypoint (override on redeploy) |
| `BASE_RPC_URL` / `ESWAP_RPC_URL` | `https://mainnet.base.org` | RPC for reads (plugin) |
| `EVM_PRIVATE_KEY` | — | Trading EOA (plugin, ElizaOS runtime setting) |

## ERC-20 decimals (explicit)

- USDC — **6**
- WETH — **18**
- cbBTC — **8**

## Security notes

- Transient storage (EIP-1153) is used by the hook for the 5x flash expansion;
  the provider never holds funds — approvals go to the router only.
- The borrow leg is bonded in `erc20BorrowEscrow`; the core's direct execution path self-bonds
  from the caller, while Enso/Contango zaps let an external JIT solver bond it. No idle liquidity
  pool or solver allowlist is required for escrow-funded fills. Unused escrow is withdrawable.
- Slippage is enforced on-chain via `minAmountOut` (default 100 bps in the core) plus a finite
  deadline. `closePosition` is trader-only; permissionless keepers must use trigger orders or
  liquidation.
- cbBTC opens are blocked client-side until phase 2 hook registration at ETA `1795195136`.
  WETH/USDC swaps and WETH trigger orders are fully live.
- The carry-savings figure is an **illustrative comparison** against a 12% APR
  continuous-borrow benchmark, not an Eswap charge (Eswap is 0.00%/day).

## Development

```bash
# Core + new suite
cd core && npm install && npm run build && npm run typecheck && npm test

# AgentKit provider
cd ../agentkit-eswap && npm install && npm run typecheck && npm test

# ElizaOS plugin
cd ../plugin-eswap && npm install && npm run typecheck && npm test
```

All packages ship pre-built `dist/` via `npm run build`. The full verification matrix is:
`build`, `typecheck`, and `test` in `core`, `mcp-server`, `game-plugin`, `agentkit-eswap`, and
`plugin-eswap`.
