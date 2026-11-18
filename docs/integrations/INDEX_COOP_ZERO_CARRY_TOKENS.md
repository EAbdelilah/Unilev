# Zero-Carry Leveraged Token Designs on Eswap (Index Coop R&D Dossier)

**Date:** 2026-11-18
**Scope:** quantitatively assess replacing a 12% borrow leg in 2x/3x/5x leveraged token designs with Eswap's 0% interest 5x venue, and sketch `ETH2x-ZERO` / `BTC3x-ZERO`.
**Status:** research/design dossier. **No Index Coop listing, product, or token exists yet**; cbBTC is phase 1 only.
**Chain:** Base mainnet (chainId `8453`).

---

## 1. Thesis

A conventional 2x/3x/5x token borrows to reach its target exposure and pays a money-market or perp funding rate on the borrow leg. At a 12% rate, a 5x token's 4x borrow costs **48% of NAV per year**. Eswap supplies that same 4x leg from a JIT solver at **0.00% borrow interest**, so the carry drag disappears. The only protocol-level charge left is the **10 bps open fee on the bought leg** (incurred again on each rebalance open).

This is a design note, not a product announcement: it describes what a token *could* do if it used Eswap as its leverage venue.

---

## 2. Exact borrow-drag math

Let `E` be holder equity (NAV), `L` the target token leverage, and `r` the benchmark borrow APR.

```
borrow leg      = E × (L − 1)
annual drag     = borrow × r
                = E × (L − 1) × r
in basis points = (L − 1) × r_bps
```

For a 5x token with `r = 12% = 1200 bps`:

```
4 × 0.12                 = 0.48 of equity
4 × 1200 bps             = 4800 bps of annual gross drag
```

Worked with $100 of NAV:

| Line | Value |
|---|---:|
| Equity (NAV) | $100.00 |
| Borrow leg (4x) | $400.00 |
| Notional (5x) | $500.00 |
| Interest @ 12% on borrow | $48.00/yr = **4800 bps** |
| Same line on Eswap @ 0% | $0.00/yr = **0 bps** |
| Gross annual drag removed | **$48.00 = 4800 bps** |

Equivalently, per 1 USDC of borrow: `1 × 1200 / (10000 × 365) × 365 = 0.12 USDC/yr`; Eswap's identical expression with `aprBps = 0` is `0`.

The repo's quote engine uses the integer form on 6-decimal USDC units:

```ts
interestUnits = borrowUnits × aprBps × days / (10_000n × 365n)
// borrowUnits = 400 × 10^6 for $100 NAV at 5x; aprBps = 1200; days = 365
// -> 48_000_000 units = $48.00 ; aprBps = 0 -> 0 for every horizon
```

---

## 3. Allocating a 2x / 3x / 5x token across Eswap's fixed 5x venue

Eswap's router offers exactly one leverage (`5`). A token that wants `L < 5` does **not** ask for a different leverage; it deploys only part of NAV as Eswap margin and holds the rest in cash (zero market exposure). The 5x notional of the deployed sleeve is then exactly the target exposure:

```
margin fraction     = L / 5
cash fraction       = 1 − L / 5
sleeve notional     = 5 × (L / 5) × E = L × E
total exposure      = L × E + 0 (cash) = L × E        ✓
borrow leg          = 4 × (L / 5) × E = (4L / 5) × E
```

| Target `L` | Eswap collateral `L/5` | Cash `1 − L/5` | Borrow `(4L/5)×E` | 12% gross drag | Drag removed |
|---:|---:|---:|---:|---:|---:|
| 2x | 40% (`2/5`) | 60% (`3/5`) | 1.6 × E | 19.2% = 1920 bps | **1920 bps** |
| 3x | 60% (`3/5`) | 40% (`2/5`) | 2.4 × E | 28.8% = 2880 bps | **2880 bps** |
| 5x | 100% (`5/5`) | 0% | 4.0 × E | 48.0% = 4800 bps | **4800 bps** |

Example, `ETH2x-ZERO` with $100 NAV: $40 posted as WETH/USDC margin to a 5x Eswap position → $200 WETH notional; $60 held as USDC cash; total ETH exposure $200 = 2x. Borrow = $160.

---

## 4. Net APY uplift and the 800 bps hurdle

The **10 bps fee is charged on the bought base-token leg**, so in NAV terms an open costs `10 bps × L`. It recurs on every rebalance open. No interest, no funding rate, no borrow accrual exist on Eswap.

| Design | Gross drag removed | Fee: 1 open (`10×L` bps) | Net vs benchmark | Fee: 4 opens/yr | Net (4/yr) |
|---|---:|---:|---:|---:|---:|
| 2x-ZERO | 1920 bps | 20 bps | **1900 bps** | 80 bps | **1840 bps** |
| 3x-ZERO | 2880 bps | 30 bps | **2850 bps** | 120 bps | **2760 bps** |
| 5x-ZERO | 4800 bps | 50 bps | **4750 bps** | 200 bps | **4600 bps** |

**Conclusion:** every design clears the **≥800 bps annual holder-APY improvement** hurdle by a wide margin under a 12% benchmark. The 5x design alone frees 4800 bps of gross drag; even after four annual rebalances it nets ~4600 bps. The 2x design, the least levered, still nets ~1840 bps — more than twice the hurdle.

Sensitivity: the hurdle is reached when `(4L/5) × r_bps − fees ≥ 800`. At `r = 12%` that is true for all three designs. If the benchmark rate were lower, the uplift would scale linearly; a 2x design would need roughly `r ≥ 5%` to clear 800 bps after fees. These are *carry deltas*, not promises about a token's total return, which still depends on the underlying asset's path, volatility decay, and execution.

---

## 5. What remains as cost, precisely

| Cost | Eswap venue | Conventional 12% venue |
|---|---|---|
| Borrow interest / funding | **0.00%** — no accruing debt | `borrow × 12% × time` |
| Protocol open/rebalance fee | **10 bps on bought leg** (× L in NAV terms) | venue-specific |
| AMM swap fee / price impact | Applies on fill (500/10 standard pool) | Applies |
| Rebalance slippage & IL | Applies to the collateral band | Applies |
| Liquidator / oracle risk | Applies; oracle is Chainlink `PriceFeed` | Applies |

"Zero carry" means **zero interest expense on the borrow leg**. It does not mean zero fees, zero slippage, zero volatility decay, or zero liquidation risk.

---

## 6. `ETH2x-ZERO` and `BTC3x-ZERO` design sketches

| Item | `ETH2x-ZERO` | `BTC3x-ZERO` |
|---|---|---|
| Target exposure | 2x ETH | 3x BTC |
| Pair | WETH/USDC | cbBTC/USDC |
| Eswap margin share | `2/5 = 40%` of NAV | `3/5 = 60%` of NAV |
| Cash share | `3/5 = 60%` USDC | `2/5 = 40%` USDC |
| Borrow leg | 1.6x NAV, 0% interest | 2.4x NAV, 0% interest |
| Fill venue | Hook pool 3000/60; standard pool 500/10 | Same structure |
| Stop-loss direction | WETH is token0 → RouterExt market **falls** on stop-loss (`aboveOrBelow = false`) | USDC is token0 → market **rises** on stop-loss (`aboveOrBelow = true`) |
| Status | Design-ready; WETH/USDC is live | **Phase 2 gated**: cbBTC hook registration ETA `1795195136` = `2026-11-20 17:18:56 UTC`; quotes return `QUOTE_FAILED` until then |

Mechanics per rebalance:

1. Compute target margin `M = (L/5) × NAV`; read fresh router/quoter output for the notional fill.
2. Encode `SwapParams` with `amountSpecified = -M` (6dp USDC), `leverage = 5`, `zeroForOne = false` (WETH) or `true` (cbBTC), and a fresh `minAmountOut`/`deadline`.
3. JIT solver bonds `4 × M` in `EswapRouter` escrow; `swapMultiPool` executes atomically.
4. The 10 bps reserve is taken on the bought leg; the position NFT accrues to the token's custody address.
5. Rebalance/trigger close via `EswapRouterExt.executeTriggerOrder` (permissionless after trader EIP-712 arm) or trader-initiated close; underwater positions can be liquidated permissionlessly via `EswapRouter.liquidate`.

---

## 7. Governance controls a token would need

| Control | On-chain reality |
|---|---|
| Rebalance authorization | `EswapRouter.rebalance` is **not** permissionless: only the trader or a whitelisted executor. The token custody address must be the trader/executor. |
| Manual close | `EswapRouter.closePosition(hook, key, trader, solver, minAmountOut)` is **trader-only**. |
| Stop-loss automation | `EswapRouterExt.executeTriggerOrder(hook, key, trader)` is **permissionless** after the trader EIP-712-arms `armTriggerOrder` and the price crosses. |
| Underwater rescue | `EswapRouter.liquidate(hook, key, trader, minAmountOut)` is **permissionless**. |
| Oracle | `PriceFeed` `0x91d75C7f750510C04516fC4dcEB5737E5B170c02`; stale/unpriced legs fail closed. |
| Pair gating | Reject cbBTC entirely before ETA `1795195136`. |

---

## 8. What is NOT claimed

- **No Index Coop listing, index, product, or `ETH2x-ZERO` / `BTC3x-ZERO` token exists.** These are hypothetical designs; no IPO, ticker registration, index methodology approval, or partnership is asserted.
- **No promised APY.** The 4800 bps figure is *gross carry removed* versus a 12% benchmark, not a projected holder return. Total return can be negative.
- **No live cbBTC product.** cbBTC/USDC phase 1 is live (pools, oracle, adapter, quoter, queue) but the hook registration executes only at ETA `1795195136`; until then `QUOTE_FAILED` applies and `BTC3x-ZERO` must not mint, quote, or trade.
- **No elimination of all costs.** Only borrow interest is zero; the 10 bps open/rebalance fee, swap costs, slippage, impermanent loss, and liquidation risk remain.
- **No claim that 12% is a current market rate.** It is the benchmark used in the repo's comparison model; a live Aave/Morpho/perp rate should be substituted for any published figure.
- **No claim that a 5x sleeve is risk-equivalent to a native 2x/3x token.** The collateral-band mechanics, liquidation thresholds, and rebalance policy differ and require independent risk review.
