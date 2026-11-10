# Eswap Agent Integration Package

Agent integrations for **Eswap** — a 5x spot margin primitive on Base mainnet
built on Uniswap v4 hooks (EIP-1153 transient storage). Two drop-in packages:

| Package | Framework | Entry point |
| --- | --- | --- |
| `@eswap/agentkit-action-provider` | Coinbase AgentKit (`@coinbase/agentkit`) | `eswapActionProvider()` |
| `@eswap/plugin-margin` | ElizaOS (`@elizaos/core`) | `eswapPlugin` |

**Protocol facts (verified on-chain 2026-11-03)**

- Network: Base mainnet, `chainId: 8453`
- Hook (margin/accounting pool): `0xe33A630503c640143126BBF222a82689D49b50c8`
- Router (entrypoint): `0xD3360D67E366Cac21a1c18fC9100B93be79e1437`
- PoolManager: `0x498581fF718922c3f8e6A244956aF099B2652b2b`
- Hook pool key: `[base, USDC, 3000, 60, hook]` (WETH/USDC and WBTC/USDC)
- Standard (deep-fill) pool: `[base, USDC, 500, 10, 0x…0]` — **configured for WETH/USDC only**; WBTC/USDC is not yet configured, so WBTC opens revert until governance registers one.
- Carry: **0.00% daily borrow interest** (no funding rate). Traders self-bond the borrow leg through `erc20BorrowEscrow`, so no solver allowlist is required.
- Protocol fee: flat **0.10% (10 bps)** of notional, settled into `protocolFees`.

> Address note: the spec originally quoted `0x6f98Ea19b5e52B88e624f2b1d7dE63F285aE1842` as the hook.
> That address is **not a contract on Base** (no bytecode, invalid EIP-55 checksum).
> The live, verified hook is `0xe33A630503c640143126BBF222a82689D49b50c8`.
> Both packages honor `ESWAP_HOOK_ADDRESS` / `ESWAP_ROUTER_ADDRESS` env overrides so a
> redeploy never requires a code change.

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
| `ESWAP_HOOK_ADDRESS` | `0xe33A630503c640143126BBF222a82689D49b50c8` | Hook contract (override on redeploy) |
| `ESWAP_ROUTER_ADDRESS` | `0xD3360D67E366Cac21a1c18fC9100B93be79e1437` | Router entrypoint (override on redeploy) |
| `BASE_RPC_URL` / `ESWAP_RPC_URL` | `https://mainnet.base.org` | RPC for reads (plugin) |
| `EVM_PRIVATE_KEY` | — | Trading EOA (plugin, ElizaOS runtime setting) |

## ERC-20 decimals (explicit)

- USDC — **6**
- WETH — **18**
- WBTC — **8**

## Security notes

- Transient storage (EIP-1153) is used by the hook for the 5x flash expansion;
  the provider never holds funds — approvals go to the router only.
- The borrow leg is self-bonded through `erc20BorrowEscrow` from the SAME EOA,
  so no solver allowlist / whitelisted relayer is required. Escrowed borrow is
  refundable via `router.withdrawBorrowEscrow` if unused.
- Slippage is enforced on-chain via `minAmountOut` (default 50 bps) plus the
  router's 15-minute deadline (`DEFAULT_DEADLINE_SLACK`).
- WBTC opens are blocked client-side until governance configures a standard fill
  venue (verified on-chain 2026-11-03: `standardPoolKeys` returns zeros).
- The carry-savings figure is an **illustrative comparison** against a 12% APR
  continuous-borrow benchmark, not an Eswap charge (Eswap is 0.00%/day).

## Development

```bash
# AgentKit provider
cd agentkit-eswap && npm install && npm run typecheck && npm test

# ElizaOS plugin
cd plugin-eswap && npm install && npm run typecheck && npm test
```

Both packages ship pre-built `dist/` via `npm run build`.
