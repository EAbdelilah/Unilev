# Eswap Integration Guide

Welcome to the Eswap Integration Guide. This document provides instructions for developers looking to connect their trading bots, aggregators, or arbitrage/liquidation bots to the Eswap DEX.

## Table of Contents
1. [Contract Overview](#contract-overview)
2. [Trading Bots](#trading-bots)
3. [Liquidators & Arbitrage Bots](#liquidators--arbitrage-bots)
4. [Aggregators](#aggregators)
5. [Flashloan Integration](#flashloan-integration)

---

## Contract Overview

The primary entry point for all interactions with Eswap is the `Market.sol` contract.

- **Market Address**: `[Insert Market Address]`
- **Positions Address**: `[Insert Positions Address]` (ERC721)

All trading operations should be performed through the `Market` contract.

---

## Trading Bots

### Opening a Position

To open a position (Long, Short, or Leverage), use the `openPosition` function in `Market.sol`.

```solidity
function openPosition(
    address _token0,        // Token you are sending (collateral)
    address _token1,        // Token you are trading against
    uint24 _fee,           // Uniswap V3 pool fee (e.g., 3000 for 0.3%)
    bool _isShort,         // true for short, false for long
    uint8 _leverage,       // Leverage (1 to 3)
    uint128 _amount,       // Amount of _token0 to deposit
    uint160 _limitPrice,   // Limit price (0 if not used)
    uint256 _stopLossPrice // Stop loss price (0 if not used)
) external;
```

**Note**: You must approve the `Market` contract to spend your `_token0` before calling this.

### Closing a Position

```solidity
function closePosition(uint256 _posId) external;
```

### Editing a Position (Stop Loss)

```solidity
function editPosition(uint256 _posId, uint256 _newStopLossPrice) external;
```

### Monitoring Positions

Use `getTraderPositions(address _trader)` to get all position IDs for a trader, and `getPositionParams(uint256 _posId)` to get detailed information about a specific position.

---

## Liquidators & Arbitrage Bots

Eswap relies on external keepers to liquidate positions that have reached their stop loss, limit price, or liquidation threshold.

### Finding Liquidatable Positions

You can query the `Market` contract for a list of all currently liquidatable position IDs:

```solidity
function getLiquidablePositions() external view returns (uint256[] memory);
```

### Executing Liquidation

Liquidate a single position or a batch:

```solidity
function liquidatePosition(uint256 _posId) external;

function liquidatePositions(uint256[] memory _posIds) external;
```

**Reward**: Liquidators receive a fixed fee (liquidation reward) taken from the trader's initial deposit. This reward is paid out in the `baseToken` of the position.

---

## Liquidity Providers

Algorithmic LPs can provide capital to Eswap pools to earn yields from leveraged positions.

### Providing Liquidity
Each token has its own `LiquidityPool` contract (ERC4626). You can find the pool address for a token by calling:
```solidity
function getTokenToLiquidityPools(address _token) external view returns (address);
```

Once you have the pool address, you can deposit assets:
1. **Approve**: Approve the `LiquidityPool` contract to spend your tokens.
2. **Deposit**: Call `deposit(uint256 assets, address receiver)` on the `LiquidityPool` contract.

### Withdrawing Liquidity
Call `redeem(uint256 shares, address receiver, address owner)` on the `LiquidityPool` contract.

---

## Aggregators

Aggregators can integrate Eswap to offer leverage and margin trading to their users.

- **Deep Liquidity**: Eswap leverages Uniswap V3 liquidity.
- **Composability**: Since positions are ERC721 NFTs, they can be easily tracked by external protocols.
- **Fees**: Aggregators can be whitelisted in `FeeManager` for custom fee structures if they bring significant volume.

---

## Flashloan Integration

Liquidators can use flashloans to provide the necessary liquidity to close margin positions if they don't have the capital upfront.

### Liquidation Flow with Flashloan:
1. **Flashloan**: Borrow the required amount of `baseToken` or `quoteToken` from a provider (e.g., Aave, Uniswap).
2. **Liquidate**: Call `market.liquidatePosition(_posId)`.
3. **Reward**: The `Market` contract sends the liquidation reward to the liquidator.
4. **Repay**: Use the received funds or your own capital to repay the flashloan.

### Example Flashloan Logic (Pseudo-code):
```solidity
function executeOperation(...) external {
    market.liquidatePosition(posId);
    // Repay flashloan
    return true;
}
```

---

## Strategic Integration Points for Volume

To maximize volume and attract traders, Eswap should be integrated with the following types of platforms:

### 1. DEX Aggregators
Aggregators route trades through multiple DEXes to find the best price for users. Integrating with them is the fastest way to get "passive" volume.
- **1inch Network**: Submit a pull request to their [Liquidity Protocol](https://github.com/1inch/1inch-network) or use their [Aggregation Protocol](https://docs.1inch.io/).
- **0x / Matcha**: Integrate via the [0x API](https://0x.org/docs/api).
- **ParaSwap**: Follow their [integration guide](https://doc.paraswap.network/).
- **KyberSwap**: List Eswap as a liquidity source on [KyberSwap](https://kyberswap.com/).
- **OpenOcean**: Apply for listing on [OpenOcean](https://openocean.finance/).

### 2. Analytics & Discovery Platforms
Traders use these platforms to find new tokens and trending DEXes.
- **DefiLlama**: Submit Eswap's adapter to [DefiLlama's GitHub](https://github.com/DefiLlama/DefiLlama-Adapters) to track TVL and Volume.
- **DexScreener**: Ensure Eswap's pools are indexed by DexScreener for visibility.
- **DEXTools**: Register as a verified DEX on [DEXTools](https://www.dextools.io/).
- **CoinGecko / CoinMarketCap**: Apply for DEX tracking once a minimum volume threshold is reached.

### 3. Yield Aggregators
Platforms like **Beefy Finance** or **Yearn** can create vaults that use Eswap's liquidity pools, providing consistent TVL.

### 4. Wallet Integrations
Many wallets have built-in swap features (e.g., MetaMask Swaps, Trust Wallet). These usually use the aggregators mentioned above, so being listed on 1inch/0x often covers this.

---

## Attracting Algorithmic Traders

Algorithmic traders (arbitrageurs, market makers, and bot operators) are the backbone of DEX volume.

1. **Incentive Programs**: Launch a "Liquidation Reward Booster" or "Trading Mining" program where bots earn extra rewards for successful liquidations or high-volume trades.
2. **Easy SDKs**: Provide a JavaScript/TypeScript SDK or a Python library that wraps the `Market.sol` functions.
3. **Subgraphs**: Deploy a [The Graph](https://thegraph.com/) subgraph to provide fast, indexed historical data for positions, prices, and volumes.
4. **Discord/Telegram Alerts**: Create a bot that broadcasts liquidatable positions to a public channel to invite competition among keepers.

---

## Useful View Functions

- `getPriceFeed()`: Get the address of the `PriceFeedL1` contract.
- `getTokenToLiquidityPools(address _token)`: Find the Eswap liquidity pool for a specific token.
- `getPositionState(uint256 _posId)`: Check if a position is `ACTIVE`, `LIQUIDATABLE`, `STOP_LOSS`, `TAKE_PROFIT`, or `EXPIRED`.
