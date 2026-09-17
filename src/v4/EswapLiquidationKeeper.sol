// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {EswapMarginHook} from "./EswapMarginHook.sol";
import {EswapRouter} from "./EswapRouter.sol";

/**
 * @title EswapLiquidationKeeper
 * @notice On-chain liquidation automation bot for Eswap V4.
 *
 * @dev Two operating modes:
 *   1. Chainlink Automation: `checkUpkeep` scans candidate positions (either from
 *      `checkData` supplied by the off-chain bot, or the owner-managed watch list)
 *      and returns `performData` describing the liquidatable subset. `performUpkeep`
 *      then executes each liquidation through the router with an oracle-derived
 *      `minAmountOut` for MEV protection.
 *   2. Direct bot: a vanilla JS/Python keeper can call `liquidateAll()` (iterates
 *      the watch list) or `liquidate()` (single position) permissionlessly.
 *
 * The hook stores positions in a mapping, so there is no on-chain enumeration.
 * Candidates must therefore be discovered off-chain (via the hook's `positions`
 * getter / public events) and either passed as `checkData` or registered in the
 * owner-managed watch list.
 */
contract EswapLiquidationKeeper is Ownable {
    using PoolIdLibrary for PoolKey;

    EswapMarginHook public immutable hook;
    EswapRouter public immutable router;

    // [P1#4] Upper bound on the owner-managed watch list so gas doesn't grow
    // unboundedly on checkUpkeep/liquidateAll. 200 positions is a full day of
    // partial-fill liquidations; off-chain discovery via checkData stays
    // permissionless and uncapped (anyone may submit arbitrary candidate lists).
    uint256 public constant MAX_WATCHES = 200;

    // Oracle-derived slippage tolerance applied when quoting minAmountOut.
    uint256 public slippageBps = 500; // 5% buffer

    struct Watch {
        PoolKey key;
        address trader;
    }

    Watch[] public watches;
    mapping(bytes32 => bool) public isWatched;

    event WatchAdded(PoolId poolId, address indexed trader);
    event WatchRemoved(PoolId poolId, address indexed trader);
    event Liquidated(PoolId poolId, address indexed trader, uint256 minAmountOut);
    event LiquidateFailed(PoolId poolId, address indexed trader);

    error PositionNotWatched();
    error AlreadyWatched();
    error MaxWatchesReached(uint256 max);
    error NoLiquidatablePositions();

    constructor(address _hook, address _router) Ownable(msg.sender) {
        hook = EswapMarginHook(payable(_hook));
        router = EswapRouter(payable(_router));
    }

    modifier validKey(PoolKey calldata key) {
        if (key.hooks != address(hook)) revert InvalidHookAddress();
        _;
    }

    error InvalidHookAddress();

    function _watchId(PoolKey memory key, address trader) internal pure returns (bytes32) {
        return keccak256(abi.encode(key.toId(), trader));
    }

    // ─── Owner watch-list management ───────────────────────────────────────────

    function setSlippageBps(uint256 _slippageBps) external onlyOwner {
        require(_slippageBps < 10000, "slippage must be < 100%");
        slippageBps = _slippageBps;
    }

    function addWatch(PoolKey calldata key, address trader) external onlyOwner validKey(key) {
        if (watches.length >= MAX_WATCHES) revert MaxWatchesReached(MAX_WATCHES);
        bytes32 id = _watchId(key, trader);
        if (isWatched[id]) revert AlreadyWatched();
        watches.push(Watch(key, trader));
        isWatched[id] = true;
        emit WatchAdded(key.toId(), trader);
    }

    function removeWatch(PoolKey calldata key, address trader) external onlyOwner {
        bytes32 id = _watchId(key, trader);
        if (!isWatched[id]) revert PositionNotWatched();
        uint256 last = watches.length - 1;
        for (uint256 i = 0; i < watches.length; i++) {
            if (_watchId(watches[i].key, watches[i].trader) == id) {
                watches[i] = watches[last];
                watches.pop();
                break;
            }
        }
        isWatched[id] = false;
        emit WatchRemoved(key.toId(), trader);
    }

    function watchesLength() external view returns (uint256) {
        return watches.length;
    }

    // ─── Oracle-derived minAmountOut ───────────────────────────────────────────

    function _position(PoolKey memory key, address trader) internal view returns (EswapMarginHook.Position memory pos) {
        (
            address traderAddr,
            uint256 collateral,
            uint256 borrowed,
            uint8 leverage,
            bool isLong,
            uint160 liqSqrtPrice,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        ) = hook.positions(key.toId(), trader);
        pos = EswapMarginHook.Position(
            traderAddr, collateral, borrowed, leverage, isLong, liqSqrtPrice, tickLower, tickUpper, liquidity
        );
    }

    /**
     * @notice Quotes a conservative minAmountOut for liquidating `trader` in `key`.
     * @dev Mirrors the hook's USD pricing convention so the quote is comparable to
     *      what the unwind swap returns. Returns 0 when no oracle is configured
     *      (TWAP-only testnets), disabling slippage protection for that position.
     */
    function quoteMinAmountOut(PoolKey memory key, address trader) public view returns (uint256) {
        EswapMarginHook.Position memory pos = _position(key, trader);
        if (pos.collateralAmount == 0) return 0;
        address priceFeed = address(hook.priceFeed());
        if (priceFeed == address(0)) return 0;

        // Collateral currency is the one bought by the opening swap; the hook resolves
        // it from the position (isLong is anchored to the pool's base currency, see
        // setBaseCurrency), so we always derive it via positionCurrencies.
        (Currency collateralCurrency, Currency debtCurrency) = hook.positionCurrencies(key, trader);
        address collateralToken = Currency.unwrap(collateralCurrency);
        address receivedToken = Currency.unwrap(debtCurrency);

        uint256 collateralUsd = hook.priceFeed().getAmountInUsd(collateralToken, pos.collateralAmount);
        uint256 receivedUsdPer18 = hook.priceFeed().getAmountInUsd(receivedToken, 1e18);
        if (receivedUsdPer18 == 0) return 0;

        uint256 expectedOut = (collateralUsd * 1e18) / receivedUsdPer18;
        return (expectedOut * (10000 - slippageBps)) / 10000;
    }

    function _isLiquidatable(PoolKey memory key, address trader) internal view returns (bool) {
        EswapMarginHook.Position memory pos = _position(key, trader);
        try hook.isLiquidatable(pos, key) returns (bool liquidatable) {
            return liquidatable;
        } catch {
            return false;
        }
    }

    // ─── Chainlink Automation interface ────────────────────────────────────────

    /**
     * @notice Scans candidate positions and reports which need liquidation.
     * @param checkData If empty, iterates the owner-managed watch list. Otherwise it
     *                  must be abi.encode(PoolKey[], address[]) of candidates to scan
     *                  (discovered off-chain). Returns performData of only the
     *                  liquidatable positions with their oracle-quoted minAmountOut.
     */
    function checkUpkeep(bytes calldata checkData) external view returns (bool upkeepNeeded, bytes memory performData) {
        uint256 len = watches.length; // [P2#10] cache-array-length (ID-278)
        uint256 candidates;

        PoolKey[] memory keys;
        address[] memory traders;
        if (checkData.length > 0) {
            (PoolKey[] memory scanKeys, address[] memory scanTraders) = abi.decode(checkData, (PoolKey[], address[]));
            len = scanKeys.length;
            keys = new PoolKey[](len);
            traders = new address[](len);
            for (uint256 i = 0; i < len; i++) {
                if (_isLiquidatable(scanKeys[i], scanTraders[i])) {
                    keys[candidates] = scanKeys[i];
                    traders[candidates] = scanTraders[i];
                    candidates++;
                }
            }
        } else {
            if (len == 0) return (false, "");
            keys = new PoolKey[](len);
            traders = new address[](len);
            for (uint256 i = 0; i < len; i++) {
                if (_isLiquidatable(watches[i].key, watches[i].trader)) {
                    keys[candidates] = watches[i].key;
                    traders[candidates] = watches[i].trader;
                    candidates++;
                }
            }
        }

        if (candidates == 0) return (false, "");

        PoolKey[] memory liqKeys = new PoolKey[](candidates);
        address[] memory liqTraders = new address[](candidates);
        uint256[] memory minOuts = new uint256[](candidates);
        for (uint256 i = 0; i < candidates; i++) {
            liqKeys[i] = keys[i];
            liqTraders[i] = traders[i];
            minOuts[i] = quoteMinAmountOut(liqKeys[i], liqTraders[i]);
        }

        return (true, abi.encode(liqKeys, liqTraders, minOuts));
    }

    /**
     * @notice Executes the liquidations returned by checkUpkeep.
     * @param performData abi.encode(PoolKey[], address[], uint256[]).
     */
    function performUpkeep(bytes calldata performData) external {
        (PoolKey[] memory keys, address[] memory traders, uint256[] memory minOuts) =
            abi.decode(performData, (PoolKey[], address[], uint256[]));
        _liquidateBatch(keys, traders, minOuts);
    }

    // ─── Direct bot entrypoints ────────────────────────────────────────────────

    /**
     * @notice Permissionless: liquidates every liquidatable position in the watch list.
     * @dev [P1#4] The watch list is NOT cleared: entries persist across races so a
     *      later round can still catch positions that weren't liquidatable yet, and
     *      after a position is gone the index simply reports 0. The returned array
     *      is indexed 1:1 with `watches` (1 = this round's liquidation succeeded,
     *      0 = skipped/failed/already gone), so bots can reconcile the outcome of
     *      every watched slot without relying on event replay.
     * @return liquidated Per-index flag (uint256 0/1) aligned with `watches`.
     */
    function liquidateAll() external returns (uint256[] memory liquidated) {
        uint256 len = watches.length; // [P2#10] cache-array-length (ID-279)
        liquidated = new uint256[](len);
        uint256 done;
        for (uint256 i = 0; i < len; i++) {
            if (_isLiquidatable(watches[i].key, watches[i].trader)) {
                if (_tryLiquidate(watches[i].key, watches[i].trader)) {
                    liquidated[i] = 1;
                    done++;
                }
            }
        }
        // Keep the old NoLiquidatablePositions guard: a batched call where nothing
        // was liquidatable is almost always a stale/duplicate keeper invocation, so
        // reverting (rather than silently returning all-zero) signals that loudly.
        if (done == 0) revert NoLiquidatablePositions();
        return liquidated;
    }

    /**
     * @notice Permissionless: liquidates a single position.
     */
    function liquidate(PoolKey calldata key, address trader) external returns (bool) {
        if (!_isLiquidatable(key, trader)) revert PositionNotLiquidatable();
        return _tryLiquidate(key, trader);
    }

    error PositionNotLiquidatable();

    function _liquidateBatch(PoolKey[] memory keys, address[] memory traders, uint256[] memory minOuts) internal {
        for (uint256 i = 0; i < keys.length; i++) {
            _tryLiquidate(keys[i], traders[i], minOuts[i]);
        }
    }

    function _tryLiquidate(PoolKey memory key, address trader, uint256 minOut) internal returns (bool) {
        try router.liquidate(address(hook), key, trader, minOut) {
            emit Liquidated(key.toId(), trader, minOut);
            return true;
        } catch {
            emit LiquidateFailed(key.toId(), trader);
            return false;
        }
    }

    function _tryLiquidate(PoolKey memory key, address trader) internal returns (bool) {
        return _tryLiquidate(key, trader, quoteMinAmountOut(key, trader));
    }
}
