// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "./libraries/LiquidityAmounts.sol";
import {TickMath} from "./libraries/TickMath.sol";

interface IPriceFeedLib {
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256);
    function getTwapPrice(address token) external view returns (uint256);
}

/**
 * @title EswapMarginLib
 * @notice Stateless pure/view logic extracted from EswapMarginHook to reduce its
 *         bytecode size below the EIP-170 24,576-byte deployment limit.
 */
library EswapMarginLib {
    error TwapNotConfigured();
    error TwapManipulated();

    // ─── Uniswap V4 Swap Price Limits ──────────────────────────────────────────

    // Mirrors TickMath.MIN_SQRT_PRICE / MAX_SQRT_PRICE from lib/v4-core. The real
    // Pool library reverts PriceLimitOutOfBounds for sqrtPriceLimitX96 <= MIN or
    // >= MAX, so a valid full-range limit must be used on every swap.
    uint160 internal constant MIN_SQRT_PRICE = 4295128739;
    uint160 internal constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    /// @dev Full-range sqrtPriceLimitX96: the least restrictive valid limit for a
    ///      swap in the given direction (no effective price floor/ceiling).
    function sqrtPriceLimit(bool zeroForOne) internal pure returns (uint160) {
        return zeroForOne ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1;
    }

    // ─── Liquidation Math ─────────────────────────────────────────────────────

    function liquidationThresholdBps(uint8 leverage) public pure returns (uint256) {
        uint256 reduction = uint256(leverage) * 200;
        return reduction < 12000 ? 12000 - reduction : 10000;
    }

    function isLiquidatable(uint256 collateralValueUsd, uint256 borrowedValueUsd, uint8 leverage)
        public
        pure
        returns (bool)
    {
        if (collateralValueUsd == 0 && borrowedValueUsd == 0) return false;
        uint256 threshold = liquidationThresholdBps(leverage);
        return collateralValueUsd * 10000 < borrowedValueUsd * threshold;
    }

    // ─── TWAP Circuit Breaker ─────────────────────────────────────────────────

    function checkTwap(
        address priceFeed,
        PoolKey calldata key,
        uint160 sqrtPriceX96,
        uint8 decimals0,
        uint8 decimals1,
        uint160 maxPriceSwingBps,
        bool requireTwapOracle
    ) public view {
        uint256 twap0 = IPriceFeedLib(priceFeed).getTwapPrice(Currency.unwrap(key.currency0));
        uint256 twap1 = IPriceFeedLib(priceFeed).getTwapPrice(Currency.unwrap(key.currency1));

        if (twap0 == 0 || twap1 == 0) {
            if (requireTwapOracle) revert TwapNotConfigured();
            return;
        }

        // Oracle convention: getTwapPrice returns USD_18dec per WHOLE token
        // (getAmountInUsd normalizes RAW amounts by the token's decimals).
        uint256 twapRatio18 = (twap0 * 1e18) / twap1;

        if (sqrtPriceX96 == 0) revert TwapManipulated();

        uint256 spotRatio18 = FullMath.mulDiv(uint256(sqrtPriceX96) * 1e18, uint256(sqrtPriceX96), 1 << 192);
        if (spotRatio18 == 0) revert TwapManipulated();

        uint8 d0 = decimals0 == 0 ? 18 : decimals0;
        uint8 d1 = decimals1 == 0 ? 18 : decimals1;
        if (d0 > d1) {
            spotRatio18 = FullMath.mulDiv(spotRatio18, uint256(10) ** (d0 - d1), 1);
        } else if (d1 > d0) {
            spotRatio18 = spotRatio18 / (uint256(10) ** (d1 - d0));
        }

        // [FIX M-10] Deviation is always anchored to the trusted oracle baseline
        // (`twapRatio18`), never the potentially-manipulated spot. Dividing by spot
        // on the downside inflated a clean downtick into a false TwapManipulated
        // (e.g. a genuine -50% move computed 100% deviation), DoS-ing opens during
        // legitimate crashes while up-side manipulation stayed correctly scaled.
        uint256 deviation = spotRatio18 >= twapRatio18
            ? ((spotRatio18 - twapRatio18) * 10000) / twapRatio18
            : ((twapRatio18 - spotRatio18) * 10000) / twapRatio18;

        if (deviation > maxPriceSwingBps) revert TwapManipulated();
    }

    // ─── Collateral Floor ─────────────────────────────────────────────────────

    /// @dev Whether a raw `marginAmount` of `token` clears the collateral floor.
    ///      When `usdFloor > 0` it is an 18-decimal USD threshold and the margin's
    ///      oracle USD value must meet it. When `usdFloor == 0` the `rawFloor`
    ///      (18-decimal normalized when the token has fewer decimals) is compared
    ///      directly — the legacy MIN_COLLATERAL path.
    function collateralOk(
        address priceFeed,
        address token,
        uint256 marginAmount,
        uint256 usdFloor,
        uint256 rawFloor,
        uint8 tokenDecimals_
    ) public view returns (bool) {
        if (usdFloor > 0) {
            uint256 marginUsd = IPriceFeedLib(priceFeed).getAmountInUsd(token, marginAmount);
            return marginUsd >= usdFloor;
        }
        uint8 decimals_ = tokenDecimals_ == 0 ? 18 : tokenDecimals_;
        uint256 raw;
        if (decimals_ >= 18) {
            raw = marginAmount / (10 ** (decimals_ - 18));
        } else {
            raw = marginAmount * (10 ** (18 - decimals_));
        }
        return raw >= rawFloor;
    }

    // ─── Saturating Math ──────────────────────────────────────────────────────

    function saturatingSub(uint256 a, uint256 b) public pure returns (uint256) {
        return a >= b ? a - b : 0;
    }

    function computeLiquidity(uint160 sqrtPriceX96, int24 tickLower, int24 tickUpper, uint256 amount, bool useAmount0)
        public
        pure
        returns (uint128)
    {
        return LiquidityAmounts.getLiquidityForAmount(
            sqrtPriceX96,
            TickMath.getSqrtRatioAtTick(tickLower),
            TickMath.getSqrtRatioAtTick(tickUpper),
            amount,
            useAmount0
        );
    }
}
