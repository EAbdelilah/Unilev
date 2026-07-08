# ESWAP V4: Owner's Launch Cost Analysis

This document provides a financial roadmap for deploying and operating the ESWAP V4 protocol on a Layer 2 network (e.g., Polygon, Arbitrum, or Base).

## 1. Fixed Deployment Costs (Gas)

Estimated gas costs for deploying the infrastructure (assuming 30 gwei on Polygon or similar L2 costs).

| Component | Est. Gas Used | Cost (USD @ $2500 ETH) |
| :--- | :--- | :--- |
| **EswapRouter** | ~1,500,000 | ~$15 - $25 |
| **EswapMarginHook** | ~2,500,000 | ~$25 - $40 |
| **Pool Initialization** | ~500,000 | ~$5 - $10 |
| **Total Gas** | **~4,500,000** | **~$45 - $75** |

*Note: Deployment is extremely cheap on L2s. The primary cost is capital, not gas.*

## 2. Capital Requirements (The Insurance Fund)

The **Insurance Fund** is the most critical cost. It facilitates the "0% interest" by bridging the borrowed portion of the trade.

| Launch Tier | Target Volume Cap | Seed Capital Required |
| :--- | :--- | :--- |
| **Alpha Launch** | $50,000 | **$10,000** |
| **Beta Launch** | $250,000 | **$50,000** |
| **Institutional** | $1,000,000 | **$200,000** |

**Why this amount?**
At 5x leverage, the protocol bridges 80% of the position value. However, because collateral is rehypothecated, the *net* capital lock is often lower. A 20% "Reserve Ratio" ($20k for $100k volume) is a safe starting point to ensure 0% interest availability.

## 3. Operational Costs (Monthly)

| Item | Description | Est. Monthly Cost |
| :--- | :--- | :--- |
| **Keeper Bots** | Gas for rebalancing & liquidations | $50 - $150 |
| **RPC Provider** | Alchemy/QuickNode (Scale tier) | $0 - $49 |
| **Hosting** | Dashboard & Bot servers | $20 - $50 |
| **Total Ops** | | **$70 - $249** |

## 4. Total "Go-Live" Estimate

### **Minimum Viable Launch: ~$10,200**
- **$10,000** Insurance Fund (USDC/WETH)
- **$200** Deployment & Initial Ops

### **Recommended Growth Launch: ~$50,500**
- **$50,000** Insurance Fund (Scales to $250k trading volume)
- **$500** Deployment, Audit buffer, and Ops

## 5. Monetization (Payback Period)
With a **0.5% Treasure Fee** on $250,000 monthly volume:
- **Revenue**: $1,250 / month
- **Yield**: Additional 2-5% APR from rehypothecated swap fees.
- **Payback**: Operational costs are covered immediately; capital remains in the pool as the protocol's "Equity."
