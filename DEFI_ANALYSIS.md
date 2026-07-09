# ESWAP V4: The Delta Settlement Deadlock & The Treasury Solution

## 1. The Technical Reality of Uniswap V4
In Uniswap V4, the `PoolManager` enforces a strict **Singleton Invariant**: all token deltas must be settled (zeroed out) by the end of the `unlock` call.

**The Challenge:**
If a trader "borrows" $800 from the pool to open a 5x position, that $800 delta **cannot** remain open across blocks. If it did, the PoolManager would revert the transaction.

## 2. ESWAP's "Perfect Solution": Treasury-Assisted Settlement
ESWAP resolves this deadlock without charging the user interest by splitting the "Execution" from the "Settlement."

1. **Unlimited Execution Depth**: The Hook returns a negative `BeforeSwapDelta` to the PoolManager. This allows the swap to execute using the **full depth of the V4 AMM reserves**. This solves the "TVL Bottleneck" for the trader’s execution.
2. **The Treasury Bridge**: Because the PM requires immediate settlement, the **ESWAP Protocol Treasury** (Insurance Fund) fulfills the physical token delivery to the PoolManager within the same block.
3. **Cross-Block Carrying**: The Hook now "owes" the Treasury, not the PoolManager. Since the Hook and Treasury are part of the same protocol, the position can remain open for **days or months** without violating V4's singleton rules.

## 3. Why this beats Aave/GMX
- **0% Interest**: Unlike Aave, where LPs demand interest because their capital is *removed* from the pool, ESWAP keeps 100% of the leveraged collateral **inside the V4 AMM** (via rehypothecation).
- **Yield Harvest**: The fees earned by this rehypothecated liquidity fully offset the Treasury's carry cost, maintaining a strict 0% interest rate for the user.

## 4. The Self-Scaling Engine
By increasing the `RESERVE_FACTOR` to 20%, the protocol builds its "Bridge Capacity" (Treasury Fund) at an accelerated rate.
- **Low Fund**: Small leverage/volume capacity.
- **High Fund**: Million-dollar "Unlimited" leverage capacity.
- **Volume Source**: Aggregators (1inch) route to ESWAP because our rehypothecated depth offers the best execution price, effectively "donating" the fees needed to scale our bridge.
