// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseHook} from "../BaseHook.sol";
import {IPoolManager} from "../interfaces/IPoolManager.sol";
import {IHooks} from "../interfaces/IHooks.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "../types/BeforeSwapDelta.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../types/BalanceDelta.sol";
import {TransientStorage} from "../libraries/TransientStorage.sol";
import {HookFlags} from "../libraries/HookFlags.sol";
import {LiquidityAmounts} from "../libraries/LiquidityAmounts.sol";
import {TickMath} from "../libraries/TickMath.sol";
import {IURC2} from "../interfaces/IURC2.sol";
import {IURC3} from "../interfaces/IURC3.sol";
import {IURC4} from "../interfaces/IURC4.sol";
import {IERC6909} from "../interfaces/IERC6909.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";

contract ProbeExtttload3 is BaseHook, IURC2, IURC3, IURC4, IERC6909 {
    using PoolIdLibrary for PoolKey;
    using PoolIdLibrary for PoolId;
    using TransientStorage for bytes32;
    using BalanceDeltaLibrary for BalanceDelta;

    constructor(IPoolManager _m) BaseHook(_m) {}

    function f(address locker, Currency c) external view returns (int256) {
        bytes32 slot = keccak256(abi.encodePacked(locker, Currency.unwrap(c)));
        (bool success, bytes memory data) =
            address(manager).staticcall(abi.encodeWithSignature("extttload(bytes32)", slot));
        require(success, "extttload failed");
        return int256(uint256(abi.decode(data, (bytes32))));
    }

    function getHookTVL(Currency) external pure override returns (uint256) { return 0; }
    function getSwappableCapacity(Currency) external pure override returns (uint256) { return 0; }
    function getIndicativeQuote(PoolKey calldata, bool, int128, bytes calldata) external pure override returns (IURC4.IndicativeQuote memory) { return IURC4.IndicativeQuote(false, 0, 0, 0); }
    function swapToPrice(PoolKey calldata, uint160, bytes calldata) external pure override returns (int128, int128) { return (0, 0); }

    function balanceOf(address, uint256) external pure override returns (uint256) { return 0; }
    function allowance(address, address, uint256) external pure override returns (uint256) { return 0; }
    function isOperator(address, address) external pure override returns (bool) { return false; }
    function transfer(address, uint256, uint256) external pure override returns (bool) { return true; }
    function transferFrom(address, address, uint256, uint256) external pure override returns (bool) { return true; }
    function approve(address, uint256, uint256) external pure override returns (bool) { return true; }
    function setOperator(address, bool) external pure override returns (bool) { return true; }
}
