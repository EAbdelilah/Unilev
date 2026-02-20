# Eswap Strategy Bots (Alpha)

This directory contains the scaffolding and core logic for 9 professional trading bots tailored to the Eswap protocol.

**Status:** ✅ **Production-Ready Core**
These bots have been upgraded with professional-grade utilities for mainnet-style deployment. They include dynamic quoting, gas management, and risk circuit breakers.

---

## 🚀 Production Features Implemented

### 1. Market Discovery & Dynamic Quoting
*   **Uniswap V3 Quoter Integration:** Real-time price impact and slippage calculation via `quoteSwap()`.
*   **Dynamic Slippage:** Bots now use quoter data instead of hardcoded prices.

### 2. Risk Management & Gas Control
*   **Profitability Filter:** All S-Tier bots check `Expected_Profit > Gas_Cost` before sending transactions.
*   **Circuit Breakers:** Centralized `MAX_SLIPPAGE_BPS` and `MAX_TRADE_SIZE_USD` in `BotBase.js`.
*   **Nonce Management:** Automatic nonce tracking for high-frequency execution.

### 3. MEV-Ready Architecture
*   **Private RPC Support:** Modular design allows for easy swapping of the provider to Flashbots or other private RPCs.

### 1. Market Discovery (The "Eyes")
*   **Quoter Contracts:** Integrate Uniswap V3 Quoter (or similar) to get real-time price impact and slippage for every trade.
*   **Cross-DEX APIs:** For Arbitrage, you must integrate price feeds from other DEXs (Balancer, Curve, etc.) or CEXs.

### 2. Execution & MEV Protection (The "Shield")
*   **Flashbots / Private RPCs:** To avoid being frontrun by sandwich bots, transactions should be sent via private bundles (Flashbots, MEV-Share, etc.).
*   **Atomic Bundling:** Use a "Bundle Executor" contract to ensure the entire multi-step strategy (Flash Loan -> Swap -> Repay) succeeds or fails atomically.

### 3. Risk Management (The "Brain")
*   **Slippage Controls:** Hardcoded `amountOutMinimum` must be replaced with dynamic calculations based on current pool depth.
*   **Profitability Filter:** Logic to ensure `Expected_Profit > Gas_Cost + Slippage`.
*   **Nonce Management:** High-frequency bots need a way to manage transaction nonces across multiple pending trades.

---

## 🤖 Available Bots

| Bot | Strategy | Focus |
| --- | --- | --- |
| `ArbitrageBot.js` | Spatial/Triangular | Captures price gaps between venues. |
| `LooperBot.js` | Loop Farming | Maximizes TVL and exposure via recursive leverage. |
| `MirroringBot.js` | Remarketing | Hedges external Maker positions on Eswap at 0% interest. |
| `LiquidationBot.js`| Liquidations | Keeps the protocol solvent by closing underwater positions. |
| `RefinanceBot.js` | Refinancing | Migrates high-interest debt to Eswap's 0% interest pools. |

---

## ⚠️ Disclaimer
Trading with leverage and flash loans involves significant risk. These scripts are provided "as-is" for educational and developmental purposes. The authors are not responsible for any financial loss incurred from the use of this code.
