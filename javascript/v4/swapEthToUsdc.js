const { ethers } = require("ethers")
const { setup } = require("./utils")

async function main() {
    const { provider, wallet, USDC, ETH } = setup()

    console.log("Swapping 0.0001 ETH -> USDC on standard pool...")

    // PoolModifyLiquidityTest or simple router swap on standard pool (hooks: 0)
    // We can use the standard PoolManager directly with a simple unlock swapper
    // Or we can deploy a tiny swapper or use PoolModifyLiquidityTest helper
    const pmAbi = [
        "function unlock(bytes calldata data) external returns (bytes memory)",
        "function swap(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, tuple(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96) params, bytes hookData) external returns (int128, int128)",
        "function take(address currency, address to, uint256 amount) external",
        "function sync(address currency) external",
        "function settle() external payable returns (uint256)"
    ]

    // Let's write a simple script in foundry or script in sol to do this swap cleanly
}

main().catch(console.error)
