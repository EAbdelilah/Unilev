# ESWAP V4: Aggregator & Solver Integration Guide (URC-2/3/4)

ESWAP V4 is built for **Invisible Distribution**. By implementing the URC standard, ESWAP margin hooks are automatically discoverable and routable by meta-aggregators (1inch) and intent-based solvers (UniswapX).

## 1. URC-4: Active Liquidity (The Solver Bridge)
Solvers need to simulate trades before submitting them. ESWAP provides a standardized `swapToPrice` interface.
*   **How it works**: A solver (e.g., UniswapX Filler) calls `getIndicativeQuote` to see if ESWAP's 0% interest margin can provide a better price than the base AMM.
*   **The Advantage**: Because ESWAP eliminates borrowing interest, our "Price to Beat" is structurally lower than any other leverage venue (GMX, dYdX). This ensures ESWAP is prioritized in the Dutch auction.

## 2. URC-2: Transparency & Indexing
ESWAP bypasses the core AMM pricing curve to provide 0% interest. To ensure this volume is tracked by Dune, DexScreener, and explorers, we emit the canonical `HookSwap` event.
*   **Event**: `HookSwap(poolId, trader, amount0, amount1, fee)`
*   **Result**: Your volume is correctly attributed, driving your protocol to the top of "Top Gainer" lists organically.

## 3. URC-3: Capacity Verified
Before a solver routes a $1M trade, they check `getSwappableCapacity`.
*   **Logic**: Returns the total collateral held by the hook that can be swapped back to debt assets (liquidations).
*   **Trust**: Integrators can verify on-chain that ESWAP has the physical capacity to fulfill the trade delta.

---
### Integration Checklist for Solvers:
1.  **Poll `IHookStats.getSwappableCapacity`** for liveness.
2.  **Call `IALFHook.getIndicativeQuote`** for price discovery.
3.  **Submit `EswapRouter.swap()`** to execute the multi-step margin trade in a single transaction.
