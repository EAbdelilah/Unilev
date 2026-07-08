# ESWAP V4: Visual Trade Flow

This diagram illustrates how a trader opens a **5x Leveraged Position** at **0% Interest** using the ESWAP V4 "End-Game" architecture.

```mermaid
sequenceDiagram
    participant T as Trader
    participant R as Eswap Router
    participant H as Eswap Margin Hook
    participant PM as V4 PoolManager (AMM)
    participant TR as Protocol Treasury

    Note over T, TR: OPENING A POSITION (5x LONG ETH)

    T->>R: 1. Deposit $20 Margin (USDC)

    rect rgb(200, 230, 255)
    Note right of R: UNLOCK Lifecycle Starts
    R->>PM: 2. Request $100 USDC -> ETH Swap

    PM->>H: beforeSwap() Callback
    H->>TR: 3. Use Treasury to settle $80 debt
    Note right of H: Treasury-Assisted Settlement
    H-->>PM: Return positive delta (Hook takes debt)

    PM->>PM: 4. Execute Swap ($100 USDC for 0.05 ETH)

    PM->>H: afterSwap() Callback
    H->>PM: 5. Take ETH into Hook Custody
    Note right of H: ERC-6909 Claim Token

    H->>PM: 6. Rehypothecate ETH as Liquidity
    Note right of H: "Smart Collateral" earns fees
    end

    R->>T: 7. Confirmation (Position Active)

    Note over T, TR: MAINTENANCE (Days 1-7)
    H->>PM: 8. Harvest Swap Fees
    Note right of H: Yield offsets capital cost = 0% INTEREST
```

### Simple Breakdown:
1. **The Down Payment:** You provide **$20**.
2. **The Boost:** The Hook uses the **Protocol Treasury** to "borrow" the other **$80** from the AMM reserves.
3. **The Buy:** One big **$100** swap happens inside Uniswap V4.
4. **The Safe-Box:** The ETH you bought is held by the **Hook** (to keep the loan safe).
5. **The Magic:** While you wait, the Hook puts your ETH back into the pool to **earn fees**.
6. **Result:** Those fees pay for the $80 boost. You pay **$0 in interest** for days!
