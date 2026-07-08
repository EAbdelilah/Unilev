# ESWAP V4: The "$0 Upfront" Launch Path

You do not need personal capital to seed the insurance fund. The ESWAP V4 architecture includes a **Self-Seeding Bootstrap Phase** that builds the fund using organic trading revenue.

## 1. The Bootstrap Flywheel

1. **Launch**: Deploy the Hook with $0 in the Insurance Fund.
2. **1x Spot Trading**: Users use the ESWAP hook for spot swaps (1x leverage).
3. **Fee Accumulation**: Every swap pays a **0.5% Treasure Fee** (`RESERVE_FACTOR`) directly into the Insurance Fund.
4. **Leverage Scaling**: As the Fund grows (e.g., $1,000 collected), the Hook automatically enables leveraged trades (up to 10x the fund balance).
5. **Growth**: Higher leverage attracts more volume -> More fees -> Larger Insurance Fund -> Higher Leverage Capacity.

## 2. Updated Launch Cost Estimate

| Component | Cost | Source |
| :--- | :--- | :--- |
| **Gas (Deployment)** | ~$50 - $100 | Owner (One-time) |
| **Insurance Fund** | **$0** | **Organic Revenue (Treasure Fees)** |
| **Ops (Monthly)** | ~$70 | Covered by first 10-20 trades |

## 3. Why this works for Aggregators
Even with 1x leverage, ESWAP is competitive on **1inch** and **Matcha** because of the rehypothecation yield (Smart Collateral). Aggregators will route volume to your pool to capture the lowest slippage, effectively "donating" the fees needed to seed your leverage engine.

## 4. Operational Strategy
- **Phase 1 (Days 1-30)**: Focus on Spot Aggregators (1inch) to build the initial $5k insurance fund.
- **Phase 2 (Day 30+)**: Enable 2x-3x leverage as the fund hits milestones.
- **Phase 3 (Mature)**: Full 5x leverage and listing on Derivative Aggregators (Mux/LogX).
