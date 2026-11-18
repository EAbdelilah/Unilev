# @eswap/core

Framework-agnostic viem v2 execution core shared by the Eswap MCP server and Virtuals G.A.M.E. plugin.

**Eswap is a pure JIT solver clearinghouse**: 5x spot margin, **0.00% borrow interest**, **0 TVL**, **0 CAC**. There is no ERC-4626 vault and no idle liquidity pool. External solvers bond the 4x borrow leg per trade in `EswapRouter.erc20BorrowEscrow`; principal is repaid at close and the solver receives the position's rehypothecation yield.

## Install / build

```bash
cd agent-integrations/core
npm install
npm run build
npm test
```

## API

```ts
import {
  getEswapQuote,
  executeEswapMargin,
  getEswapPoolInfo,
  createEswapClient,
  loadEswapEnv,
} from "@eswap/core";

loadEswapEnv(); // optional: reads .env from cwd without overriding process.env

const quote = await getEswapQuote({ pair: "WETH/USDC", collateralUsdc: "100" });

const simulation = await executeEswapMargin({
  pair: "cbBTC/USDC",
  collateralUsdc: "100",
  slippageBps: 100,
  dryRun: true,
});

const live = await executeEswapMargin({ pair: "WETH/USDC", collateralUsdc: "100" });
// live.baseScanUrl -> https://basescan.org/tx/0x...
```

`createEswapClient({ rpcUrl, privateKey, readOnly })` returns a reusable client with
`getEswapQuote`, `executeEswapMargin` and `getPoolInfo` methods. `BASE_RPC_URL` defaults to
`https://mainnet.base.org`; `PRIVATE_KEY` is only needed for broadcasts. `ESWAP_READ_ONLY=1`
forces every non-dry-run call to be rejected.

## Live constants

| Item | Value |
| --- | --- |
| Chain | Base mainnet, `8453` |
| Hook | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` |
| Router | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` |
| RouterExt (trigger orders / ERC-7683) | `0x907CdA8c588c9C859A6fB4F105593a64599741CB` |
| PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` |
| PriceFeed | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` |
| ERC-7683 settlement | `0x6F347acB3bD901731e192d482b7a40c50f30FCa1` |
| Quoter (fallback) | `0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, 6 decimals |
| WETH | `0x4200000000000000000000000000000000000006`, 18 decimals |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf`, 8 decimals |
| Hook pool | `[currency0, currency1, 3000, 60, hook]` |
| Fill pool | `[currency0, currency1, 500, 10, address(0)]` |
| Leverage | Fixed `5x` |
| Open fee | `10 bps` of the bought leg |
| Borrow carry | `0.00%` (no funding rate) |

**PoolKey ordering:** Uniswap v4 requires `currency0 < currency1`. `WETH (0x4200…) < USDC (0x8335…)`,
so `currency0 = WETH`. `USDC (0x8335…) < cbBTC (0xcbB7…)`, so `currency0 = USDC` for that pair. The
core derives `zeroForOne` from this ordering instead of hard-coding it: `false` for WETH/USDC and
`true` for cbBTC/USDC when the trader deposits USDC.

## Quote math

1. `parseCollateralUnits` enforces exact 6-decimal USDC input (no scientific notation, no extra precision).
2. `router.quoteExactInput(hookKey, zeroForOne, -collateralUnits, 5)` is called via read-only `eth_call`;
   the dedicated quoter is a fallback. The router returns gross base-token output using the deep
   standard pool's slot0 price with an execution discount.
3. `protocolFeeUnits = gross * 10 / 10_000`; `netUnits = gross - protocolFeeUnits`.
4. Borrow leg is `collateral * 4`. Benchmark 12% APR interest is
   `borrow * 1200 * days / (10_000 * 365)` for `days = 7, 30`; Eswap's is always zero.

## Execution lifecycle (`executeEswapMargin`)

1. Read `allowance(owner, router)`; approve the exact collateral if needed.
2. Read `erc20BorrowEscrow(owner, USDC)`; `depositBorrowEscrow(USDC, missing)` to self-bond 4x.
3. Encode `SwapParams` with `amountSpecified = -collateralUnits`, `leverage = 5`, `solver = owner`,
   `minAmountOut = quote * (1 - slippageBps/10000)`, `deadline = now + 300s`.
4. `router.swapMultiPool(params)` via `walletClient`, wait for the receipt, return the BaseScan URL.

`dryRun: true` performs the reads and a `simulateContract` call but never signs or broadcasts.

**Live status note (2026-11-18):** WETH/USDC quotes resolve on Base. cbBTC/USDC phase 1 is live:
both pools are initialized and the Chainlink feed, adapter, quoter and timelock queue are wired
(`src/v4/test/EswapBaseCbBtcUsdcForkTest.t.sol` covers the end state). The queued hook
registration executes at ETA `1795195136` (2026-11-20 17:18:56 UTC). Until then the hook still
rejects the pair and quoting returns `QUOTE_FAILED`; no trades should be attempted before phase 2.

## Universal aggregator & automation suite

The core also ships pure, injection-friendly builders for partner routing, keepers and leveraged
tokens. They never hardcode a partner APR or imply a live listing; quotes and rates are supplied by
the caller.

```ts
import { buildEnsoShortcut, buildContangoQuote, buildUniDexRoute } from "@eswap/core/adapters";
import {
  createGelatoWeb3Function,
  buildTriggerOrderTypedData,
  generateDcaSchedule,
} from "@eswap/core/automation";
import {
  calculateLeverageTokenMath,
  buildLifiMarginZap,
  buildErc7683MarginIntent,
} from "@eswap/core/rebalancer";
```

| Subpath | Exports | Purpose |
| --- | --- | --- |
| `@eswap/core/adapters` | `buildEnsoShortcut`, `buildContangoQuote`, `buildUniDexRoute` | Selector-based shortcut payloads, normalized cPerp quotes, 15-minute aggregator routes |
| `@eswap/core/automation` | `createGelatoWeb3Function`, `buildTriggerOrderTypedData`, `generateDcaSchedule` | `canExec` keeper evaluation, EIP-712 trigger arming, recurring 5x DCA orders |
| `@eswap/core/rebalancer` | `calculateLeverageTokenMath`, `buildLeverageTokenRebalance`, `buildLifiMarginZap`, `buildErc7683MarginIntent` | 2x/3x/5x collateral allocation, close/reopen bundles, LI.FI + ERC-7683 zaps |

Automation safety rules are encoded in the helpers: `EswapRouter.closePosition` is trader-only;
keepers use permissionless `EswapRouterExt.executeTriggerOrder` after a trader-signed arm and price
cross, or `EswapRouter.liquidate` for underwater positions. RouterExt's market price is
`USD(token0)/USD(token1)`, so WETH/USDC stop-losses cross **below** while cbBTC/USDC stop-losses
cross **above** (USDC is `token0`).

Governance-ready dossiers live in
[`docs/integrations/`](../../docs/integrations): Contango, Enso, Index Coop and Gelato. All four
include explicit “What is NOT claimed” sections; no partner listing or Gelato task is asserted.
