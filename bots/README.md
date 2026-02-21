# Eswap Strategy Bots (Alpha)

This directory contains the scaffolding and core logic for 9 professional trading bots tailored to the Eswap protocol.

**Status:** 🏆 **Production-Ready (Atomic Execution)**
These bots have been upgraded with a professional on-chain executor (`StrategyExecutor.sol`) and a 0% interest flash loan system. They are now capable of executing multi-step trades atomically in a single transaction.

---

## 🚀 Production Features Implemented

### 0. Atomic Execution (On-Chain)
*   **StrategyExecutor.sol:** A dedicated smart contract that handles `flashLoan` callbacks from the protocol. This ensures that strategies like Arbitrage and Refinancing either succeed entirely or revert, protecting the operator from partial fills or price slippage.

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
*   **Quoter Contracts:** Integrated. Bots use Uniswap V3 Quoter to get real-time price impact and slippage.
*   **Oracle Sync:** Integrated. Bots compare Chainlink Oracle prices with Market prices to find arbitrage.

### 2. Execution & MEV Protection (The "Shield")
*   **StrategyExecutor.sol:** Integrated. All multi-step trades are executed atomically on-chain.
*   **Private RPCs:** The `BotBase` architecture is ready to connect to Flashbots or other MEV-protection RPCs.

### 3. Risk Management (The "Brain")
*   **Slippage Controls:** Dynamic calculations based on quoter data.
*   **Profitability Filter:** Integrated. `checkProfitability` ensures `Expected_Profit > Gas_Cost`.
*   **Nonce Management:** Centralized nonce tracking in `BotBase.js`.

---

## 🔌 Live Data Integration Guide

To connect these bots to real mainnet data, follow these integration steps:

### 1. Mirroring (CEX Integration)
*   **Library:** Use `ccxt` for standardized CEX WebSocket support.
*   **Implementation:** Replace `getExternalFills()` with a WebSocket listener for the `orders` or `myTrades` topic on Binance/Coinbase.
*   **Security:** Use restricted API keys with **Spot Read-Only** permissions.

### 2. Arbitrage & JIT (Mempool Integration)
*   **Provider:** Use a high-performance node provider like **Blocknative**, **Alchemy**, or **Infura**.
*   **Logic:** For JIT, use the `pendingTransactions` WebSocket to detect whale trades before they are included in a block.
*   **Execution:** Wrap your transactions in **Flashbots Bundles** to ensure you are the first to execute and avoid revert costs.

### 3. Yield Hopping (Off-Chain Analytics)
*   **API:** Use the **DeFi Llama APY API**.
*   **Logic:** Fetch the current `apyBase` for Uniswap V3 pools on Polygon and compare them against Eswap's internal utilization rates.

---

## 🤖 Available Bots

| Bot | Strategy | Focus |
| --- | --- | --- |
| `ArbitrageBot.js` | Spatial/Triangular | Captures price gaps between venues. |
| `MirroringBot.js` | Remarketing | Hedges external Maker positions on Eswap at 0% interest. |
| `LiquidationBot.js`| Liquidations | Keeps the protocol solvent by closing underwater positions. |

---

## ⚠️ Disclaimer
Trading with leverage and flash loans involves significant risk. These scripts are provided "as-is" for educational and developmental purposes. The authors are not responsible for any financial loss incurred from the use of this code.
