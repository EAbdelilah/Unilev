// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EswapLeverageQuoter
 * @notice Pre-routing quote helper for ODOS / Enso Finance aggregators.
 *         Provides off-chain or on-chain indicative quotes for leveraged
 *         position opens, enabling aggregators to compute optimal routes
 *         before submitting the actual swap via EswapLeverageAdapter.
 *
 * @dev Reads the same pool registry as EswapLeverageAdapter.
 *      Delegates to EswapRouter.quoteExactInput() which uses the
 *      on-chain slot0 price of the execution (standard) pool for parity
 *      with actual execution output.
 */
contract EswapLeverageQuoter is Ownable {
    using PoolIdLibrary for PoolKey;

    EswapRouter public immutable router;

    struct PoolRegistration {
        PoolKey hookPoolKey;
        PoolKey standardPoolKey;
    }

    mapping(address => mapping(address => mapping(uint24 => PoolRegistration))) public poolRegistry;

    error PoolNotRegistered(address tokenIn, address tokenOut, uint24 fee);

    event PoolRegistered(address indexed tokenIn, address indexed tokenOut, uint24 fee);

    constructor(EswapRouter _router) Ownable(msg.sender) {
        router = _router;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function registerPool(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        PoolKey calldata hookPoolKey,
        PoolKey calldata standardPoolKey
    ) external onlyOwner {
        poolRegistry[tokenIn][tokenOut][fee] =
            PoolRegistration({hookPoolKey: hookPoolKey, standardPoolKey: standardPoolKey});
        emit PoolRegistered(tokenIn, tokenOut, fee);
    }

    // ─── Quoter Entry Points ────────────────────────────────────────────

    /**
     * @notice Quote the expected output for a leveraged position open.
     * @param tokenIn   ERC-20 input token (margin currency).
     * @param tokenOut  ERC-20 output token (collateral currency).
     * @param fee       Pool fee tier.
     * @param leverage  Position leverage (1-20). 1 = spot.
     * @param amountIn  Exact margin amount.
     * @return amountOut  Estimated collateral amount (before 0.5% protocol fee).
     */
    function quoteExactInputSingleWithLeverage(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint8 leverage,
        int256 amountIn
    ) external view returns (int128 amountOut) {
        PoolRegistration storage reg = _getPool(tokenIn, tokenOut, fee);
        bool zeroForOne = _isCurrency0(tokenIn, reg.hookPoolKey);

        return router.quoteExactInput(reg.hookPoolKey, zeroForOne, int128(int256(amountIn)), leverage);
    }

    // ─── View Helpers ───────────────────────────────────────────────────

    function getPoolKey(address tokenIn, address tokenOut, uint24 fee)
        external
        view
        returns (PoolKey memory hookPoolKey, PoolKey memory standardPoolKey)
    {
        PoolRegistration storage reg = _getPool(tokenIn, tokenOut, fee);
        return (reg.hookPoolKey, reg.standardPoolKey);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _getPool(address tokenIn, address tokenOut, uint24 fee)
        internal
        view
        returns (PoolRegistration storage reg)
    {
        reg = poolRegistry[tokenIn][tokenOut][fee];
        if (reg.hookPoolKey.hooks == address(0)) {
            revert PoolNotRegistered(tokenIn, tokenOut, fee);
        }
    }

    function _isCurrency0(address token, PoolKey memory poolKey) internal pure returns (bool) {
        return Currency.unwrap(poolKey.currency0) == token;
    }
}
