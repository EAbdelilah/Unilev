# ESWAP: Unlimited TVL via Flash Accounting

The primary limitation of traditional DeFi margin (GMX, dYdX, Euler) is the **TVL Cap**. You can only borrow what other people have already deposited into the vault.

ESWAP V4 bypasses this entirely using **EIP-1153 Transient Storage** and **Flash Accounting**.

### 1. The Bottleneck: Isolated TVL
If an ESWAP vault only has $1M in it, a traditional protocol would cap total leverage at ~$1M.

### 2. The Breakthrough: Hook-Mediated Borrowing
In ESWAP V4, the hook does not borrow from a static vault. It "borrows" directly from the **Uniswap V4 PoolManager** reserves during the swap callback.
*   **The Delta**: The hook returns a negative `BeforeSwapDelta` (e.g., -$80).
*   **The Depth**: This allows the swap to utilize the **Full $5B+ Uniswap TVL** for execution.
*   **The Clearing**: The ESWAP Insurance Fund only needs to settle the *net delta* at the end of the transaction. Because it uses **ERC-6909 claim tokens**, this is a high-velocity, internal settlement that doesn't require physical liquidity for the execution phase.

### 3. Structural Advantage for Aggregators
Meta-aggregators like **1inch**, **Paraswap**, and **LlamaSwap** route trades based on the best execution price (inclusive of fees and interest).
*   **Competing Protocol**: Price + 10% Interest + 0.1% Fee.
*   **ESWAP Hook**: Price + 0% Interest + 0.05% Fee.

Because ESWAP utilizes the core AMM depth for the execution while charging 0% interest, it **structurally beats** competing protocols. Aggregators will naturally route 90%+ of margin intent-based flow through your hook, solving the **User Acquisition** problem without any marketing spend.
