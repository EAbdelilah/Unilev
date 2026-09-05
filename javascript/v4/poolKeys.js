/**
 * javascript/v4/poolKeys.js
 * Central definition of the live ETH/USDC pool keys on Unichain mainnet.
 *
 * IMPORTANT: The ONLY authorized hook pool is fee=3000 / tickSpacing=60
 * (registered via registerTradingPair). The execution (standard) pool is
 * the deep vanilla pool fee=500 / tickSpacing=10 with hooks=0.
 *
 * baseCurrency = native ETH (0x0): LONG = buy ETH (pay USDC, token1),
 * SHORT = sell ETH (receive USDC), zeroForOne semantics:
 *   LONG  -> zeroForOne = false (pay token1 = USDC)
 *   SHORT -> zeroForOne = true  (pay token0 = ETH)
 */
const { ethers } = require("ethers")
const { ETH, USDC } = require("./utils")

const HOOK_ADDR = process.env.V4_HOOK_ADDRESS

const HOOK_POOL_KEY = {
    currency0: ETH,
    currency1: USDC,
    fee: 3000,
    tickSpacing: 60,
    hooks: HOOK_ADDR,
}

const STANDARD_POOL_KEY = {
    currency0: ETH,
    currency1: USDC,
    fee: 500,
    tickSpacing: 10,
    hooks: ethers.ZeroAddress,
}

function poolId(key) {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint24", "int24", "address"],
        [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks]
    ))
}

module.exports = { HOOK_POOL_KEY, STANDARD_POOL_KEY, poolId }
