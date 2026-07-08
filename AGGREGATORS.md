# ESWAP V4: Aggregator & Solver Integration Roadmap

To maximize user acquisition without a proprietary frontend, ESWAP targets meta-aggregators and intent-based networks where its **0% interest model** provides a structural execution advantage.

## 1. Primary Listing Targets

| Aggregator / Network | Integration Type | Competitive Edge |
| :--- | :--- | :--- |
| **UniswapX** | Dutch Auction Fillers | Fillers can utilize ESWAP's rehypothecated liquidity to settle orders with 0% interest overhead, beating external CEX/DEX hedges. |
| **CoW Swap** | Solver Network | Solvers simulate ESWAP's URC-4 `swapToPrice` to include margin liquidity in split-fill routes, offering better "Net Price" due to zero borrow fees. |
| **1inch Fusion** | Resolver Integration | Resolvers (Resolvers/Market Makers) route through the ESWAP hook to capture the 0% interest "Smart Collateral" yield, improving their quote competitiveness. |
| **Odos / Matcha** | Smart Order Routing | Standardized URC-3 stats allow these aggregators to index ESWAP as a high-liquidity venue for leveraged pairs (e.g., WBTC/USDC). |

## 2. Competitive Advantage vs. Incumbents

| Feature | GMX / dYdX | ESWAP V4 Hook |
| :--- | :--- | :--- |
| **Borrowing Cost** | 5% - 25% APR | **0% APR** (Subsidized by fees) |
| **Routing** | Siloed / Custom | **Programmatic (URC-4)** |
| **Capital Efficiency** | Isolated Pool | **V4 Native (AMM + Hook)** |
| **Execution** | External Oracle | **Atomic (V4 Lifecycle)** |

## 3. Integration Steps for Solvers

1. **Indicative Quote**: Solvers call `getIndicativeQuote` to check liveness and estimated output.
2. **Capacity Check**: `getSwappableCapacity` (URC-3) reports the total rehypothecated margin available for routing.
3. **Execution Path**: Solvers call `swapToPrice` (URC-4) to determine the exact tick-impact and slippage within the hook's concentrated range.
4. **Settlement**: The trade is executed via the `EswapRouter` to ensure atomic settlement of the hook's transient deltas.
