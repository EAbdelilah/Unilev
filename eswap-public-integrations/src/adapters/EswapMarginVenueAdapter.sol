// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IEswapMarginVenue} from "./IEswapMarginVenue.sol";
import {EswapRouter} from "../../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../../src/v4/types/PoolId.sol";
import {Currency} from "../../../src/v4/types/Currency.sol";
import {BalanceDelta} from "../../../src/v4/types/BalanceDelta.sol";

/// @dev Minimal view/execute surface of the live Base EswapRouter (0x5b22...).
///      Uses the canonical `EswapRouter.SwapParams` type so integrators encode
///      the exact tuple shape verified on Basescan.
interface IEswapRouterPublic {
    function swapMultiPool(EswapRouter.SwapParams calldata params) external payable returns (bytes memory);

    function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut)
        external;

    function depositBorrowEscrow(address token, uint256 amount) external;

    function erc20BorrowEscrow(address solver, address token) external view returns (uint256);

    function registeredSolvers(address solver) external view returns (bool);

    function quoteExactInput(PoolKey calldata key, bool zeroForOne, int128 amountSpecified, uint8 leverage)
        external
        view
        returns (int128);

    function DEFAULT_DEADLINE_SLACK() external view returns (uint256);
}

interface IEswapHookView {
    function protocolFeeFor(address trader) external view returns (uint256);
}

/**
 * @title EswapMarginVenueAdapter
 * @notice Unified 5x spot-margin venue adapter for Contango / 1delta / VOOI /
 *         UniDex / Flipper / MUX / Defi App style aggregators.
 *
 * @dev Custody model: the ADAPTER is the router `trader`. This is required
 *      because `EswapRouter.closePosition` is trader-only; the adapter can
 *      therefore close and forward the USDC payout to the original caller.
 *      Consequence: one live position per pool per adapter deployment. Deploy
 *      one adapter per partner/routing context and serialize opens per pair.
 *
 *      solverData:
 *        - `0x`                         caller self-bonds: adapter pulls
 *                                       margin + 4x borrow, funds escrow.
 *        - abi.encode(address solver)   external JIT solver; adapter pulls
 *                                       only margin, solver must be registered
 *                                       or fully capitalised in escrow.
 */
contract EswapMarginVenueAdapter is IEswapMarginVenue, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    // ─── Canonical Base mainnet constants ───────────────────────────────────
    address public constant HOOK = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address public constant ROUTER = 0x5b226aE5158de86f1E616875dBab886870B9aAd9;
    address public constant POOL_MANAGER = 0x498581fF718922c3f8e6A244956aF099B2652b2b;

    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;

    uint256 public constant LEVERAGE_BPS = 50_000;
    uint256 public constant FUNDING_RATE_BPS = 0;
    uint256 public constant ESTIMATED_GAS = 520_000;

    IEswapRouterPublic public immutable router;
    IEswapHookView public immutable hook;

    // ─── Errors ─────────────────────────────────────────────────────────────
    error UnsupportedPair();
    error InvalidLeverage();
    error InvalidSolverData();
    error ZeroAmount();
    error ActivePositionExists();
    error NoActivePosition();
    error Unauthorized();
    error SolverNotCapitalized();
    error ZeroSwapOutput();

    // ─── Events ─────────────────────────────────────────────────────────────
    event PositionOpened(
        bytes32 indexed positionId,
        address indexed owner,
        address indexed solver,
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 notionalSize,
        uint256 boughtAmount,
        uint256 protocolFeeUnits,
        uint256 feeBps
    );

    event PositionClosed(bytes32 indexed positionId, address indexed owner, uint256 netPayoutUsdc);

    struct PositionRecord {
        address owner;
        address solver;
        bytes32 poolId;
        PoolKey key;
        uint256 collateralAmount;
        uint256 boughtAmount;
    }

    uint256 public positionNonce;
    uint256 public lastBoughtAmount;
    uint256 public lastProtocolFeeUnits;
    uint256 public lastFeeBps;

    mapping(bytes32 => PositionRecord) public positions;
    /// @dev One live position per hook pool, because the adapter is the trader.
    mapping(bytes32 => bytes32) public activePositionId;

    constructor() {
        router = IEswapRouterPublic(ROUTER);
        hook = IEswapHookView(HOOK);
    }

    /// @inheritdoc IEswapMarginVenue
    function openLeveragedPosition(
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 leverageBps,
        uint256 minAmountOut,
        bytes calldata solverData
    ) external override nonReentrant returns (bytes32 positionId, uint256 notionalSize) {
        if (leverageBps != LEVERAGE_BPS) revert InvalidLeverage();
        return _openFor(msg.sender, collateralAsset, targetAsset, collateralAmount, minAmountOut, solverData);
    }

    /// @dev Shared open path; also used by the Enso execution adapter.
    function _openFor(
        address owner,
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 minAmountOut,
        bytes memory solverData
    ) internal returns (bytes32 positionId, uint256 notionalSize) {
        if (collateralAmount == 0) revert ZeroAmount();
        if (owner == address(0)) revert Unauthorized();

        (PoolKey memory key, bool zeroForOne, bool usdcIsInput) = _resolvePair(collateralAsset, targetAsset);
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (activePositionId[poolId] != bytes32(0)) revert ActivePositionExists();

        uint256 margin = collateralAmount;
        uint256 borrow = margin * (LEVERAGE_BPS / 10_000 - 1);
        notionalSize = margin + borrow;

        address solver = _decodeSolver(solverData);
        IERC20 input = IERC20(collateralAsset);

        if (solver == address(this)) {
            // Self-bond: owner funds the full notional; adapter bonds the borrow.
            input.safeTransferFrom(owner, address(this), notionalSize);
            input.forceApprove(ROUTER, borrow);
            router.depositBorrowEscrow(collateralAsset, borrow);
        } else {
            // External JIT solver: owner funds margin only. The router will draw
            // the borrow from the solver's escrow (or direct transferFrom for a
            // registered solver).
            input.safeTransferFrom(owner, address(this), margin);
            if (!router.registeredSolvers(solver) && router.erc20BorrowEscrow(solver, collateralAsset) < borrow) {
                revert SolverNotCapitalized();
            }
        }

        // Leave only the margin allowance at swap time; zero it after the fill.
        input.forceApprove(ROUTER, margin);

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: key,
            standardPoolKey: _standardKey(key),
            zeroForOne: zeroForOne,
            amountSpecified: -int256(margin),
            leverage: 5,
            solver: solver,
            hookData: abi.encode(true, uint8(5), address(this)),
            deadline: block.timestamp + router.DEFAULT_DEADLINE_SLACK(),
            minAmountOut: minAmountOut
        });

        bytes memory ret = router.swapMultiPool(params);
        input.forceApprove(ROUTER, 0);

        int256 packed = abi.decode(ret, (int256));
        BalanceDelta delta = BalanceDelta.wrap(packed);
        int128 rawOut = zeroForOne ? delta.amount1() : delta.amount0();
        if (rawOut <= 0) revert ZeroSwapOutput();
        uint256 boughtAmount = uint256(uint128(rawOut));

        uint256 feeBps = hook.protocolFeeFor(address(this));
        uint256 feeUnits = (boughtAmount * feeBps) / 10_000;

        positionId = keccak256(abi.encode(address(this), poolId, owner, ++positionNonce));
        positions[positionId] = PositionRecord({
            owner: owner,
            solver: solver,
            poolId: poolId,
            key: key,
            collateralAmount: margin,
            boughtAmount: boughtAmount
        });
        activePositionId[poolId] = positionId;

        lastBoughtAmount = boughtAmount;
        lastProtocolFeeUnits = feeUnits;
        lastFeeBps = feeBps;

        // feeUnits is in bought-token units; USDC-equivalent = notional * bps.
        uint256 protocolFeeUsdc = usdcIsInput ? (notionalSize * feeBps) / 10_000 : (boughtAmount * feeBps) / 10_000;
        emit PositionOpened(
            positionId,
            owner,
            solver,
            collateralAsset,
            targetAsset,
            margin,
            notionalSize,
            boughtAmount,
            protocolFeeUsdc,
            feeBps
        );
    }

    /// @inheritdoc IEswapMarginVenue
    function closeLeveragedPosition(bytes32 positionId, uint256 minAmountOut, bytes calldata)
        external
        override
        nonReentrant
        returns (uint256 netPayoutUsdc)
    {
        PositionRecord storage record = positions[positionId];
        if (record.owner != msg.sender) revert Unauthorized();
        return _closeFor(positionId, minAmountOut);
    }

    /// @dev Shared close path; also used by the Enso execution adapter.
    function _closeFor(bytes32 positionId, uint256 minAmountOut) internal returns (uint256 netPayoutUsdc) {
        PositionRecord storage record = positions[positionId];
        if (record.owner == address(0)) revert NoActivePosition();
        // Cache before the storage slot is deleted below.
        address owner = record.owner;
        PoolKey memory key = record.key;
        bytes32 poolId = record.poolId;

        uint256 beforeBalance = IERC20(USDC).balanceOf(address(this));
        router.closePosition(HOOK, key, address(this), record.solver, minAmountOut);
        uint256 afterBalance = IERC20(USDC).balanceOf(address(this));
        netPayoutUsdc = afterBalance > beforeBalance ? afterBalance - beforeBalance : 0;

        delete activePositionId[poolId];
        delete positions[positionId];

        if (netPayoutUsdc > 0) {
            IERC20(USDC).safeTransfer(owner, netPayoutUsdc);
        }
        emit PositionClosed(positionId, owner, netPayoutUsdc);
    }

    /// @inheritdoc IEswapMarginVenue
    function quoteMarginRoute(
        address collateralAsset,
        address targetAsset,
        uint256 collateralAmount,
        uint256 leverageBps
    )
        external
        view
        override
        returns (uint256 notionalOut, uint256 protocolFeeUsdc, uint256 fundingRateBps, uint256 estimatedGas)
    {
        if (leverageBps != LEVERAGE_BPS) revert InvalidLeverage();
        if (collateralAmount == 0) revert ZeroAmount();

        (PoolKey memory key, bool zeroForOne, bool usdcIsInput) = _resolvePair(collateralAsset, targetAsset);
        int128 quoted = router.quoteExactInput(key, zeroForOne, -int128(uint128(collateralAmount)), 5);
        if (quoted <= 0) revert ZeroSwapOutput();

        notionalOut = uint256(uint128(quoted));
        uint256 feeBps = hook.protocolFeeFor(address(this));
        // On-chain fee is charged on the bought leg. For USDC-in longs the fee
        // is in base tokens; the USDC equivalent is notional * bps. For shorts
        // the bought leg is already USDC.
        protocolFeeUsdc = usdcIsInput
            ? (collateralAmount * 5 * feeBps) / 10_000
            : (notionalOut * feeBps) / 10_000;
        fundingRateBps = FUNDING_RATE_BPS;
        estimatedGas = ESTIMATED_GAS;
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    function _decodeSolver(bytes memory solverData) internal view returns (address solver) {
        if (solverData.length == 0) return address(this);
        if (solverData.length != 32) revert InvalidSolverData();
        solver = abi.decode(solverData, (address));
        if (solver == address(0)) revert InvalidSolverData();
    }

    function _resolvePair(address collateralAsset, address targetAsset)
        internal
        pure
        returns (PoolKey memory key, bool zeroForOne, bool usdcIsInput)
    {
        address base;
        if (collateralAsset == USDC && targetAsset == WETH) {
            base = WETH;
            usdcIsInput = true;
        } else if (collateralAsset == USDC && targetAsset == CBBTC) {
            base = CBBTC;
            usdcIsInput = true;
        } else if (collateralAsset == WETH && targetAsset == USDC) {
            base = WETH;
            usdcIsInput = false;
        } else if (collateralAsset == CBBTC && targetAsset == USDC) {
            base = CBBTC;
            usdcIsInput = false;
        } else {
            revert UnsupportedPair();
        }

        if (base == WETH) {
            // WETH (0x4200..) sorts below USDC (0x8335..): currency0 = WETH.
            key = PoolKey({
                currency0: Currency.wrap(WETH),
                currency1: Currency.wrap(USDC),
                fee: 3000,
                tickSpacing: 60,
                hooks: HOOK
            });
        } else {
            // USDC sorts below cbBTC (0xcbB7..): currency0 = USDC.
            key = PoolKey({
                currency0: Currency.wrap(USDC),
                currency1: Currency.wrap(CBBTC),
                fee: 3000,
                tickSpacing: 60,
                hooks: HOOK
            });
        }

        // Long (USDC in) is zeroForOne=false for WETH/USDC and true for cbBTC/USDC.
        zeroForOne = usdcIsInput ? Currency.unwrap(key.currency0) == USDC : Currency.unwrap(key.currency0) != USDC;
    }

    function _standardKey(PoolKey memory key) internal pure returns (PoolKey memory) {
        return
            PoolKey({
                currency0: key.currency0,
                currency1: key.currency1,
                fee: 500,
                tickSpacing: 10,
                hooks: address(0)
            });
    }
}
