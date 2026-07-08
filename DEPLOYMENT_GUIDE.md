# ESWAP V4: Go-Live & Deployment Guide

Follow these steps to deploy the ESWAP V4 0% Interest Margin Hook to a live network (Polygon, Arbitrum, etc.).

## 1. Environment Setup
Ensure your `.env` contains:
- `PRIVATE_KEY`: Your deployment wallet.
- `POOL_MANAGER_ADDRESS`: Official Uniswap V4 PoolManager address.
- `PRICE_FEED_ADDRESS`: Chainlink PriceFeed or similar for USD valuations.

## 2. Infrastructure Deployment
Run the Forge script to deploy the Router and Hook:
```bash
forge script scripts/v4/DeployHook.s.sol:DeployHook --rpc-url <YOUR_RPC> --broadcast --via-ir
```

## 3. Post-Deployment Configuration (CRITICAL)

### A. Seed the Insurance Fund
The 0% interest model requires the hook to "bridge" capital transiently. You **must** seed the `insuranceFund` in the Hook with a buffer of USDC/WETH.
1. Call `IERC20.transfer(hookAddress, amount)` for the desired tokens.
2. The Hook will automatically use these to facilitate 0% interest swaps.

### B. Initialize V4 Pools
You must initialize Uniswap V4 pools that use the ESWAP Hook.
1. Use the `PoolManager.initialize()` function.
2. Set the `hooks` parameter to your deployed `EswapMarginHook` address.

### C. Oracle Verification
Ensure the `priceFeed` address passed during deployment is correctly returning USD values for the tokens in your pools. The liquidation engine relies on this for safety.

### D. Whitelist Liquidity
Optionally, call `setAuthorizedPool` on the Hook to restrict margin trading to specific high-liquidity pairs.

## 4. Frontend Integration
1. Update `dashboard/src/hooks/useDeFi.js` with your newly deployed `V4_ROUTER` and `V4_HOOK` addresses.
2. The dashboard will automatically switch to "Solver-Ready" mode using the new architecture.

## 5. Keeper Setup
To ensure liquidations happen promptly, run a keeper bot that calls:
`EswapRouter.maintain(hookAddress, poolKey, trader)`
This will check for liquidatable positions and execute them atomically.
