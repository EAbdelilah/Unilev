# Leverage Mechanics on Eswap

This document explains the technical details of how Long and Short leverage positions are executed on Eswap, specifically focusing on the USDC/WBTC pair.

## Overview
Eswap uses a **"provide what you long, borrow what you short"** model. This leverages Uniswap V3 liquidity and Chainlink price feeds to provide 0% interest rate margin trading.

In the **USDC/WBTC** pair:
- **WBTC** is the Base Token.
- **USDC** is the Quote Token.

---

## 1. Long 2x Leverage on WBTC
A long position is a bet that the price of WBTC will increase relative to USDC.

### Workflow:
1. **Deposit (Collateral):** The trader sends **WBTC** (Base Token) to the `Market` contract.
2. **Fees:** A small treasury fee and a liquidation reward are deducted from the deposit.
3. **Borrowing:** To achieve 2x leverage, the protocol borrows the **Quote Token (USDC)** from the USDC Liquidity Pool. The borrowed amount is equal to the value of the deposited WBTC.
4. **The Swap:** The protocol automatically swaps the borrowed USDC for more **WBTC** via Uniswap V3.
5. **The Position:** The trader now holds a total position of ~2x their initial WBTC, with a debt denominated in USDC.

### Outcomes:
- **WBTC Price Rises:** The 2x WBTC position increases in value relative to the USDC debt. Upon closing, WBTC is sold to repay the USDC loan, and the profit remains in WBTC.
- **WBTC Price Falls:** The value of the WBTC position drops while the USDC debt remains fixed. If the equity falls below the liquidation threshold (~10% of margin), the position is liquidated.

---

## 2. Short 2x Leverage on WBTC
A short position is a bet that the price of WBTC will decrease relative to USDC.

### Workflow:
1. **Deposit (Collateral):** The trader sends **USDC** (Quote Token) to the `Market` contract.
2. **Fees:** Fees are deducted from the USDC deposit.
3. **Borrowing:** The protocol borrows the **Base Token (WBTC)** from the WBTC Liquidity Pool. For 2x leverage, it borrows WBTC equal to the value of the collateral.
4. **The Swap:** The protocol immediately swaps the borrowed **WBTC for USDC** on Uniswap V3.
5. **The Position:** The trader now holds the USDC from the swap plus their initial collateral, but has a debt denominated in WBTC.

### Outcomes:
- **WBTC Price Falls:** It becomes cheaper to buy back the WBTC debt. Upon closing, the protocol uses USDC to buy back the WBTC, repays the loan, and the trader keeps the excess USDC profit.
- **WBTC Price Rises:** The cost to buy back the WBTC debt increases. If the cost approaches the total USDC held in the position, the position is liquidated.

---

## Key Technical Details

| Feature | Long WBTC | Short WBTC |
| :--- | :--- | :--- |
| **Token Deposited** | WBTC (Base) | USDC (Quote) |
| **Token Borrowed** | USDC (Quote) | WBTC (Base) |
| **Interest Rate** | 0% | 0% |
| **Max Leverage** | 3x | 3x |

### 0% Interest Rate
Eswap eliminates interest rates by using Liquidity Providers' assets directly for margin trades. Revenue is generated via fixed fees at the start and end of the trade, allowing traders to focus on price action without the "clock" eating their profits.

### Liquidation
A position is liquidatable if the equity (Collateral + PnL) falls below the **Liquidation Threshold** (10% of initial margin). In a 2x scenario, a price move of ~45% against the trader typically triggers liquidation.
