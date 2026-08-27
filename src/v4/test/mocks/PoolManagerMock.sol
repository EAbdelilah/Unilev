// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "../../interfaces/IPoolManager.sol";
import {PoolKey} from "../../types/PoolKey.sol";
import {Currency} from "../../types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "../../types/BalanceDelta.sol";
import {PoolId} from "../../types/PoolId.sol";

interface IUnlockCallback {
    function unlockCallback(bytes calldata data) external returns (bytes memory);
}

/// @notice Mock PoolManager implementing the REAL Uniswap V4 IPoolManager ABI
///         (mirrored in src/v4/interfaces/IPoolManager.sol). Swap/modifyLiquidity
///         deltas are simulated; extsload/exttload expose persistent + transient
///         storage slots exactly like the real PoolManager so the hook's slot0
///         and currency-delta reads work unchanged.
contract PoolManagerMock is IPoolManager {
    using BalanceDeltaLibrary for BalanceDelta;

    struct ModifyLiquidityCall {
        PoolKey key;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    ModifyLiquidityCall[] public modifyLiquidityCalls;

    struct SwapCall {
        PoolKey key;
        bool zeroForOne;
        int128 amountSpecified;
        bytes hookData;
    }

    SwapCall[] public swapCalls;

    struct Slot0Data {
        uint160 sqrtPriceX96;
        int24 tick;
        uint16 protocolFee;
        uint24 lpFee;
    }

    mapping(PoolId => Slot0Data) public slot0;
    // Emulates the PoolManager's persistent storage so `extsload` returns the
    // pool slot0 at the exact keccak256 mapping slot the real PM uses.
    mapping(bytes32 => bytes32) public persistentStorage;
    mapping(address => mapping(uint256 => uint256)) public balances;
    BalanceDelta public overrideSwapDelta;
    bool public hasOverrideSwapDelta;
    uint256 public settleCount;
    uint256 public takeCount;
    BalanceDelta public overrideModifyLiquidityDelta;
    bool public hasOverrideModifyLiquidityDelta;

    function setSlot0(PoolId id, uint160 sqrtPriceX96, int24 tick) external {
        slot0[id] = Slot0Data(sqrtPriceX96, tick, 0, 3000);
        // Pack exactly like the real Pool.State.slot0 at mapping slot 0:
        // _pools[id].slot0 lives at keccak256(abi.encode(id, uint256(0))).
        bytes32 packed = bytes32(
            uint256(sqrtPriceX96) | uint256(int256(tick) << 160) | (uint256(0) << 184) | (uint256(3000) << 200)
        );
        persistentStorage[keccak256(abi.encode(id, uint256(0)))] = packed;
        persistentStorage[keccak256(abi.encodePacked(PoolId.unwrap(id), bytes32(uint256(6))))] = packed;
    }

    function swapCallsLength() external view returns (uint256) {
        return swapCalls.length;
    }

    function setCurrencyDelta(address locker, Currency currency, int256 delta) external {
        // Mirrors CurrencyDelta._computeSlot: keccak256(abi.encodePacked(target, currency))
        bytes32 slot = keccak256(abi.encodePacked(locker, Currency.unwrap(currency)));
        assembly ("memory-safe") {
            tstore(slot, delta)
        }
    }

    function setNextSwapDelta(int128 delta0, int128 delta1) external {
        overrideSwapDelta = BalanceDeltaLibrary.toBalanceDelta(delta0, delta1);
        hasOverrideSwapDelta = true;
    }

    function setNextModifyLiquidityDelta(int128 delta0, int128 delta1) external {
        overrideModifyLiquidityDelta = BalanceDeltaLibrary.toBalanceDelta(delta0, delta1);
        hasOverrideModifyLiquidityDelta = true;
    }

    function balanceOf(address owner, uint256 id) external view returns (uint256) {
        return balances[owner][id];
    }

    function unlock(bytes calldata) external virtual override returns (bytes memory) {
        return "";
    }

    function initialize(PoolKey memory, uint160) external override returns (int24) {
        return 0;
    }

    function swap(PoolKey calldata key, IPoolManager.SwapParams calldata params, bytes calldata hookData)
        external
        virtual
        override
        returns (BalanceDelta delta)
    {
        swapCalls.push(
            SwapCall({
                key: key,
                zeroForOne: params.zeroForOne,
                amountSpecified: int128(params.amountSpecified),
                hookData: hookData
            })
        );
        if (hasOverrideSwapDelta) {
            hasOverrideSwapDelta = false; // consume once
            return overrideSwapDelta;
        }
        // Enforce real swap direction semantics:
        //   zeroForOne=true  → selling token0 (amount0<0), receiving token1 (amount1>0)
        //   zeroForOne=false → selling token1 (amount1<0), receiving token0 (amount0>0)
        // Use a 1:1 exchange rate with 4% slippage for realistic output.
        uint256 absIn = uint256(int256(params.amountSpecified < 0 ? -params.amountSpecified : params.amountSpecified));
        int128 output = int128(uint128((absIn * 96) / 100));
        int128 input = -int128(uint128(absIn));
        if (params.zeroForOne) {
            // selling token0 → receiving token1
            delta = BalanceDeltaLibrary.toBalanceDelta(input, output);
        } else {
            // selling token1 → receiving token0
            delta = BalanceDeltaLibrary.toBalanceDelta(output, input);
        }
    }

    function modifyLiquidity(PoolKey calldata key, IPoolManager.ModifyLiquidityParams calldata params, bytes calldata)
        external
        override
        returns (BalanceDelta delta, BalanceDelta)
    {
        modifyLiquidityCalls.push(
            ModifyLiquidityCall({
                key: key,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidityDelta: int128(params.liquidityDelta)
            })
        );
        if (hasOverrideModifyLiquidityDelta) {
            hasOverrideModifyLiquidityDelta = false; // consume once
            return (overrideModifyLiquidityDelta, BalanceDeltaLibrary.toBalanceDelta(0, 0));
        }
        return (delta, BalanceDeltaLibrary.toBalanceDelta(0, 0));
    }

    function donate(PoolKey memory, uint256, uint256, bytes calldata) external override returns (BalanceDelta) {
        return BalanceDeltaLibrary.toBalanceDelta(0, 0);
    }

    function sync(Currency) external virtual override {}

    function settle() external payable virtual override returns (uint256) {
        settleCount++;
        return 0;
    }

    function settleFor(address) external payable virtual override returns (uint256) {
        settleCount++;
        return 0;
    }

    function clear(Currency, uint256) external override {}

    function take(Currency currency, address to, uint256 amount) external virtual override {
        // Faithful to V4 flash accounting: taking credits the recipient with
        // PM-backed value (real PM moves ERC20 out; claim-style crediting keeps
        // the mint/burn accounting loop closed identically for the hook).
        balances[to][uint256(uint160(Currency.unwrap(currency)))] += amount;
        takeCount++;
    }

    function mint(address to, uint256 id, uint256 amount) external override {
        balances[to][id] += amount;
    }

    function burn(address from, uint256 id, uint256 amount) external override {
        if (balances[from][id] >= amount) {
            balances[from][id] -= amount;
        }
    }

    function updateDynamicLPFee(PoolKey memory, uint24) external override {}

    function extsload(bytes32 slot) external view override returns (bytes32) {
        return persistentStorage[slot];
    }

    function exttload(bytes32 slot) external view override returns (bytes32) {
        bytes32 value;
        assembly ("memory-safe") {
            value := tload(slot)
        }
        return value;
    }
}

/**
 * @dev Like PoolManagerMock but unlock() forwards to the caller's unlockCallback,
 *      mirroring real V4 so the router's unlock flow can be exercised in tests.
 */
contract PoolManagerCallbackMock is PoolManagerMock {
    function unlock(bytes calldata data) external override returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }
}

/**
 * @dev Extends PoolManagerCallbackMock with real ERC20 token movement for take/settle.
 *      Used for JIT spot execution integration tests.
 *      - sync() records the last synced currency
 *      - settle() transfers tokens from the last payer to this contract
 *      - settleFor() same but credits a specific recipient
 *      - take() transfers tokens from this contract to the recipient
 */
contract PoolManagerRealTokenMock is PoolManagerCallbackMock {
    Currency internal _pendingCurrency;
    address internal _pendingFrom;
    mapping(address => mapping(address => uint256)) public tokenBalances;

    function sync(Currency currency) external override {
        _pendingCurrency = currency;
    }

    function settle() external payable override returns (uint256 amount) {
        address token = Currency.unwrap(_pendingCurrency);
        // Determine how many tokens were transferred to us since last sync
        amount = IERC20Mock(token).balanceOf(address(this));
        settleCount++;
    }

    function settleFor(address) external payable override returns (uint256 amount) {
        address token = Currency.unwrap(_pendingCurrency);
        amount = IERC20Mock(token).balanceOf(address(this));
        settleCount++;
    }

    function take(Currency currency, address to, uint256 amount) external override {
        IERC20Mock(Currency.unwrap(currency)).transfer(to, amount);
        takeCount++;
    }
}

interface IERC20Mock {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}
