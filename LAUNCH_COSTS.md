# ESWAP V4: The $0 Launch Roadmap

ESWAP is designed to bootstrap itself from $0 upfront capital by leveraging the "Flywheel of Organic Volume."

## Phase 1: Spot Margin (The 1x Seed)
*   **Action**: Launch the Hook with an empty `insuranceFund`.
*   **Mechanism**: The Hook allows traders to open **1x Leverage** positions (Spot Margin).
*   **Revenue**: Because these are spot trades, they don't require a bridge. The 0.5% `RESERVE_FACTOR` is still applied to the swap output.
*   **Goal**: Accumulate the first $10,000 in the Insurance Fund via organic trading volume and rehypothecation yield.

## Phase 2: Low-Leverage Expansion (2x - 3x)
*   **Action**: Enable 2x and 3x leverage for whitelisted pairs.
*   **Mechanism**: The accumulated Insurance Fund now serves as the "Bridge" to settle the V4 singleton deltas for the borrowed portion.
*   **Growth**: High-leverage trades generate larger "Treasure Fees" (as fees are calculated on the full $100 position, not just the $20 margin). This accelerates Insurance Fund growth.

## Phase 3: Unlimited Scaling (5x+)
*   **Action**: Open the protocol to the full 5x leverage limit.
*   **Flywheel**: Aggregators (1inch, Paraswap) begin routing high-value intent-based trades through the Hook because its 0% interest model offers structurally better execution prices.
*   **End-Game**: The protocol becomes a self-sustaining liquidity engine where the Insurance Fund is large enough to bridge millions in daily volume, all while maintaining 0.0% interest for every trader.

---
**Founder Capital Required**: $0.
**Growth Engine**: Organic swap fees + Rehypothecation yield.
