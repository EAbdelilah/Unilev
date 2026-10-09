# Eswap B2B — Aggregator Submission Pack

**Chain:** Unichain Mainnet (chain ID `130`)
**Last verified against chain:** see "Verification log" at the bottom
**Status:** submission-ready with explicit placeholders. Read "What is NOT claimed" before sending.

This document is the single source of truth for submitting Eswap to aggregator
intake forms (Odos, 1inch, ParaSwap, KyberSwap, Enso). The machine-readable
versions live in `integrations/aggregators/`:

| File | Purpose |
|---|---|
| `integrations/aggregators/shared.ts` | Addresses, pool keys, pool IDs, selectors, ABIs, cost model |
| `integrations/aggregators/odos_registration.json` | Odos intake payload |
| `integrations/aggregators/oneinch_paraswap_kyber.json` | Unified 1inch / ParaSwap / KyberSwap spec |
| `integrations/aggregators/enso_shortcut.ts` | Enso shortcut builder + SDK projection |

`test/b2b_master_integration.test.ts` asserts that the values in this document
and in those files agree, and that every failure path fails closed.

---

## 1. What you are integrating

Eswap is a **leveraged swap venue** on Uniswap V4. A trader posts a margin
deposit and a leverage multiplier; the protocol opens a single-pool position
whose size is `margin × leverage`.

Critically for an aggregator: **Eswap needs no TVL of its own.**

- The **accounting pool** (fee `3000`, tick spacing `60`, hook attached) is where
  the position is registered and priced.
- The **settlement pool** (fee `500`, tick spacing `10`, **no hooks**) is the deep
  ETH/USDC pool where the physical fill actually executes.

The borrowed leg is supplied by an independent solver and settled against the
V4 `PoolManager` using transient flash accounting inside a single `unlock`, so
there is no separate Eswap liquidity pool to seed and no asynchronous settlement
step. See `src/v4/EswapRouter.sol:764-785`.

---

## 2. Contracts

| Role | Address | Verified on chain |
|---|---|---|
| **Adapter** — your entrypoint | `0xC5616D22892828a500b5957efA9e5CcCD59d5C70` | 5,837 bytes |
| **Quoter** — quoting only | `0x3177f4e53a0EE0318174771b32E68aDe63c20f3b` | 2,379 bytes |
| Router | `0xe7c5AE37DDAca662B483ab5F29a30860835e8C3b` | 21,589 bytes |
| Hook | `0x4Bd545f6438a27614098984E1322939af53AD0C8` | deployed |
| LiquidationKeeper | `0x5E8aDA65050962c62A815932BF38dc144E0545DA` | 7,451 bytes, **0 watches** |
| Default solver | `0x518634753C61342298c3E04326056b3Ce596a566` | whitelisted |

**Never call the router directly.** Use the adapter. The router's direct
leverage entrypoint requires the caller's address to be in `registeredSolvers`,
and the adapter additionally handles the solver fallback.

### Sourcify / explorer verification status

**Not yet verified.** `docs/SECURITY_AUDIT_V4.md` in this repository is an
internal review, not a published third-party audit. Until verification lands,
leave `contracts.adapter.verified` and `contracts.quoter.verified` as `false`.
Do not enter an audit firm name in an intake form on the strength of that file.

---

## 3. Entrypoints and selectors

### 3.1 Open a leveraged position

```
exactInputSingleWithLeverage(
  address tokenIn,
  address tokenOut,
  uint24 fee,
  uint8 leverage,
  uint256 amountIn,      // MARGIN ONLY — not notional
  uint256 minAmountOut,
  address recipient      // receives the ERC-6909 collateral claim
)
```
Selector `0xb4d2ebae`. **Nonpayable.**

The `amountIn` field is the single most common integration error. It is the
**margin**, not the position size:

```
notional = margin × leverage
borrow   = margin × (leverage − 1)     // the solver's leg
```

Passing the notional as `amountIn` requests roughly `leverage×` the intended
exposure.

### 3.2 Open with an aggregator prefill leg

```
exactInputSingleWithLeverageAggregator(
  address tokenIn, address tokenOut, uint24 fee, uint8 leverage,
  uint256 amountIn, uint256 minAmountOut, address recipient,
  (address exchangeProxy, address tokenIn, address tokenOut,
   uint256 sellAmount, uint256 value, bytes callData) route
)
```
Selector `0x062c4889`. **Nonpayable.**

This executes your venue leg inside the **same** `unlock` as the leveraged leg,
so the prefill and the leverage settle atomically. Use it when the prefill must
come from a venue Eswap cannot reach natively. When it is not needed, prefer
`0xb4d2ebae`: fewer moving parts and a smaller gas budget.

### 3.3 Quote

```
quoteExactInputSingleWithLeverage(
  address tokenIn, address tokenOut, uint24 fee, uint8 leverage, int256 amountIn
) → int128 amountOut
```
Selector `0x21294f6d`. **View.**

Two verified behaviours that contradict the obvious reading of the types:

1. **The sign of `amountIn` is discarded.** `EswapRouter.quoteExactInput` computes
   `absAmount = amountSpecified < 0 ? -amountSpecified : amountSpecified`. Live
   verification: `-10000000` and `+10000000` return the identical `amountOut`.
2. **`amountOut` is always positive.** Do not branch on its sign to infer
   direction; take direction from `zeroForOne` on the pool key.

This is a **spot approximation**: it reads `slot0` and applies no price impact,
then discounts by `QUOTE_EXECUTION_DISCOUNT_BPS`. It systematically over-states
executable output. A real fill additionally pays the settlement pool's 5 bps,
the 10 bps protocol toll, and tick-walking impact. Size `minAmountOut` from
observed fills, not from the quote alone.

---

## 4. Pool keys and pool IDs

Pool ID is `keccak256(abi.encode(currency0, currency1, fee, tickSpacing, hooks))`.

| Pool | currency0 | currency1 | fee | tickSpacing | hooks | Pool ID |
|---|---|---|---|---|---|---|
| Accounting | `0x0…0` (native ETH) | USDC | 3000 | 60 | `0x4Bd5…0dC8` | `0x4b830e9b09c2717fc198a556651bf2569eda7e57dcfb5b801db6e1c2eadf2591` |
| Settlement | `0x0…0` (native ETH) | USDC | 500 | 10 | `0x0…0` | `0x3258f413c7a88cda2fa8709a589d221a80f6574f63df5a5b6774485d8acc39d9` |

USDC is `0x078D782b760474a361dDA0AF3839290b0EF57AD6`.

**ETH/USDC uses native ETH, not WETH.** `currency0` is `address(0)`. A WETH-quoted
route addresses a different pool and will not find liquidity.

### 4.1 The stale-hook trap

The predecessor hook was `0x9aa5ebac…` predecessor pool
`0x9aa5ebac305d4fd646bca230471bcb0df55d89b8b32e94559a0a7471b21ccaae`. Because
`hooks` is hashed into the Pool ID, carrying a stale hook address does **not**
revert — it silently addresses the old, unused pool. Always source `hooks` from
`{ADAPTER}.getPoolKey(tokenIn, tokenOut, fee)` rather than hardcoding it.

### 4.2 Registry lookup orientation

**Verified live:** `{ADAPTER}.poolRegistry` is keyed by **route orientation**:
`poolRegistry(USDC, ETH, 3000)`.

Reading it as `poolRegistry(ETH, USDC, 3000)` returns an all-zero struct
**without reverting**. That is indistinguishable from "pool not registered" and
is a silent miss. `REGISTRY_LOOKUP` in `shared.ts` encodes the correct order.

---

## 5. Integrations

### 5.1 Approval discipline

Approve **margin only**, to the **adapter**:

```solidity
tokenIn.approve(ADAPTER, margin);
```

Never approve the borrow from the trader. The router pulls the borrowed leg from
the **solver** via `safeTransferFrom(params.solver, …)`. A trader-side borrow
approval is both unnecessary and unsafe.

### 5.2 Odos / ParaSwap / 1inch / KyberSwap

`amountIn` is margin in every venue's payload. Map Eswap's `address(0)` native
ETH to whatever native/wrapped identifier the venue expects. KyberSwap needs
reserve-free pool metadata, because Eswap's balance sheet is transient V4 deltas
and exposes no reserve getters.

**KyberSwap Unichain support is `VERIFY_AT_INTAKE`.** Confirm the deployment with
Kyber directly before submitting a route; do not assume parity with Ethereum or
Base.

### 5.3 Enso

`integrations/aggregators/enso_shortcut.ts` builds the descriptor and a plain-object
projection for `@ensofinance/sdk`, so this package installs with `viem` alone.
`valueBps` defaults to the protocol's own 30 bps round-trip cost. Override with
your measured edge — Enso ranks shortcuts by `valueBps`, and letting the SDK
fabricate it would rank an unprofitable route above a profitable one.

---

## 6. Costs

| Component | bps | Notes |
|---|---|---|
| Protocol toll | 10 | Charged at open |
| Settlement pool fee | 5 | Physical leg, paid to the pool |
| Flash premium | **0** | `InventoryFlashProvider.flashLoan` hardcodes `feeAmounts[0] == 0` |
| **Round trip** | **30** | 15 at open + 15 at close |

A route is only worth taking when its own edge clears 30 bps **plus** your margin.
30 bps is the floor, not a target.

---

## 7. Gas — ignore the intake template's 110k

The intake templates ask for ~110k overhead. That is wrong by roughly an order of
magnitude.

| Measurement | Gas |
|---|---|
| Full leveraged round trip (open + close, fork) | `1,185,089` |
| Open alone (fork reference) | `1,239,388` |
| Overhead above a plain swap | ~950k – 1M |

A leveraged round trip is not a drop-in fee-tier swap: it opens a position, mints
an ERC-6909 collateral claim, registers solver debt with principal and yield,
then closes and settles the ledger. **Re-measure with a live `estimateGas` before
quoting a production number** — the figures above are fork-local and will drift.

---

## 8. Events

```
LeveragedSwapRouted(address tokenIn, address tokenOut, uint24 fee,
                    uint8 leverage, uint256 amountIn, uint256 amountOut)
```
`topic0 = 0x24ecc0da`, `indexed: [tokenIn, tokenOut]`, emitted by the hook.

`topic0` is computed with `keccak256` over the exact declaration in `src/v4/`
and is asserted by the test harness. It is **not yet** confirmed against a
verified explorer ABI. Re-confirm after verification lands.

---

## 9. Limits and risk

| Parameter | Value |
|---|---|
| Min leverage | 2 |
| Max leverage (live hook) | 5 |
| Observed min margin | `0.01` USDC reverts `CollateralTooLow()` (`0xb67e07e5`) |

Read the live minimum. Do not assume sub-cent positions clear the floor.

### Revert selectors

| Selector | Error |
|---|---|
| `0xb67e07e5` | `CollateralTooLow()` |
| `0x292cdffd` | `SolverNotRegistered(address)` |
| `0x90781743` | `InsufficientBorrowEscrow(uint256,uint256)` |
| `0x2f9fe61a` | `InsufficientSolverCollateral` |
| `0x5090d6c6` | `AlreadyUnlocked()` |

---

## 10. Solver disclosure — required by intake forms

A leveraged open **cannot fill** without a named solver funding the borrowed leg.
The adapter uses `defaultSolver`, falling back to `backupSolver`; if neither is
available the call reverts.

On close, the solver is repaid **principal plus accumulated yield**. Both are
readable on chain at
`hook.solverDebts(poolId, trader, solver)`, which is how you verify repayment
rather than taking it on trust.

### What is NOT claimed

These are the claims intake reviewers must not accept, and this package will not
make:

1. **Solver capital is not guaranteed by the smart contract.** On an unwind that
   proceeds less than the debt, the insurance fund is drawn first (capped at the
   ERC-6909 claims actually held), then the remainder is recorded as `badDebt`
   rather than reverting, and the solver payout is truncated to available
   proceeds (`src/v4/EswapMarginHookLogic2.sol:490-497`). Payment priority, not a
   guarantee.
2. **The keeper is deployed but covers nothing.** `EswapLiquidationKeeper` is live
   at `0x5E8aDA65050962c62A815932BF38dc144E0545DA` and answers `watchesLength()` —
   which currently returns `0`. No position is under automated liquidation.
   Coverage is added owner-only via `addWatch()`. "Deployed" and "protecting" are
   different claims.
3. **No APY figure is offered.** Yield depends on the LP band and the price path
   between open and close. `accumulatedYield` is measurable after the fact; it is
   not a forecast.
4. **110k gas is not quoted** (see §7).
5. **No third-party audit is claimed** (see §2).

---

## 11. Verification log

Regenerate with:

```
node scripts\node_modules\tsx\dist\cli.mjs test\b2b_master_integration.test.ts
```

The harness has two modes. Offline it runs ~145 encoding checks. With
`UNICHAIN_RPC_URL` set it adds ~12 live checks covering pool registration,
selector agreement, quoter behaviour and keeper state.

Before submitting, confirm:

- [ ] `verified: false` still accurate for adapter and quoter
- [ ] `topic0 0x24ecc0da` re-confirmed against the verified ABI
- [ ] gas re-measured with a live `estimateGas`
- [ ] KyberSwap Unichain support confirmed directly with Kyber (`VERIFY_AT_INTAKE`)
- [ ] `REPLACEMENTS` in `odos_registration.json` fully resolved (6 items)
- [ ] `REPLACEMENTS` in `oneinch_paraswap_kyber.json` fully resolved (4 items)
- [ ] project website, contact email and audit status filled in
- [ ] **Alchemy key rotated** before sending — the key in the local `.env` was
      exposed during development and should not reach any partner

## 12. Package contents

```
integrations/
  aggregators/
    shared.ts                        addresses, pool keys, selectors, cost model
    odos_registration.json           Odos intake payload
    oneinch_paraswap_kyber.json      1inch / ParaSwap / KyberSwap spec
    enso_shortcut.ts                 Enso descriptor + SDK projection
  solvers/
    shared.ts                        solver escrow / debt helpers
    cow/appData_schema.json          leverage-commitment metadata schema
    cow/fillCoWOrder.ts              CoW order build, precheck, fill calldata
    uniswapx/fillUniswapXOrder.ts    Reactor order, economics screen, fill
    oneinch-fusion/fillFusionOrder.ts  TakerTraits, post-interaction, fill
  crosschain/
    across_erc7683_relayer.ts        ERC-7683 decode, precheck, fill
test/
  b2b_master_integration.test.ts     the harness described above
```

The settlement contracts are **not deployed**. Every venue address in the
solver and cross-chain modules is a deliberate zero-address placeholder. Those
modules are encoding-complete and encoding-tested; they are not live
integrations. `test/b2b_master_integration.test.ts` asserts this is visible
rather than hiding it.