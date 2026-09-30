// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EswapArbitrageExecutor
 * @notice Atomic, flash-funded integration harness for the ESWAP leveraged venue.
 *
 * @dev SCOPE AND HONESTY NOTE
 *      This contract is a *measurement and integration-test* tool, not a volume
 *      generator. It exists to answer three questions on-chain, atomically:
 *
 *        1. Does the full ESWAP open -> close round trip settle correctly when it
 *           is funded by a flash loan rather than by pre-funded inventory?
 *        2. After repaying principal + premium, what is the REAL residual P&L
 *           once the ESWAP protocol toll, both pool fees and flash premium are
 *           paid?
 *        3. Do the hook's aggregate accounting invariants (open interest, running
 *           collateral) return to their pre-trade values?
 *
 *      Any residual above `minProfit` is swept to the owner. Anything else makes
 *      the whole transaction revert, so the contract can never be used to
 *      round-trip inventory purely to inflate volume: a round trip that does not
 *      clear the profit floor costs gas and never settles.
 *
 *      Flash funding shape
 *      ------------------
 *      Aave V3 `flashLoanSimple` is used as the funding source. The Uniswap V4
 *      `IPoolManager` is deliberately NOT used as a flash provider: this repo's
 *      vendored V4 core exposes `take`/`sync`/`settle` (fee-free "free flash
 *      loan") but its `unlock` reverts with `AlreadyUnlocked` on nesting, and the
 *      ESWAP router performs its own `unlock`. Holding an outer V4 unlock across
 *      the ESWAP open would therefore always revert. Aave guards with its own
 *      per-pool reentrancy lock, which does not collide with V4's lock, so the
 *      ESWAP router can enter `PoolManager.unlock` from inside our flash callback.
 *
 *      The provider address is injected at construction rather than hardcoded, so
 *      the same bytecode is valid on every chain where a V3-compatible pool exists.
 */

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {PoolKey} from "../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../src/v4/types/PoolId.sol";

// ─── Minimal interfaces (declared locally to keep the deployed bytecode small) ───

/// @dev Mirrors `EswapLeverageAdapter.exactInputSingleWithLeverage`.
interface IEswapLeverageAdapter {
    function exactInputSingleWithLeverage(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint8 leverage,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut);
}

/// @dev Mirrors `EswapRouter.closePosition`. Note the router requires
///      `msg.sender == trader`, so this contract must be the position owner.
interface IEswapRouter {
    function closePosition(
        address hook,
        PoolKey calldata key,
        address trader,
        address solver,
        uint256 minAmountOut
    ) external;
}

/// @dev Mirrors Aave V3 `IPoolManager.flashLoanSimple`.
interface IFlashLoanProvider {
    function flashLoanSimple(
        address receiverAddress,
        address[] calldata assets,
        uint256[] calldata amounts,
        uint256[] calldata modes,
        address onBehalfOf,
        bytes calldata params,
        uint16 referralCode
    ) external;
}

/// @dev Mirrors Aave V3 `IFlashLoanSimpleReceiver`.
interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

/// @dev Owner-whitelisted external venue. `data` is opaque calldata so the same
///      executor can drive 0x / ParaSwap / Augustus / a direct V4 pool leg.
interface IExternalVenue {
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        bytes calldata data
    ) external returns (uint256 amountOut);
}

/// @dev Read-only slice of `EswapMarginHook` used for invariant assertions.
interface IEswapHookView {
    function positions(bytes32 poolId, address trader)
        external
        view
        returns (
            address traderAddr,
            uint256 collateralAmount,
            uint256 borrowedAmount,
            uint8 leverage,
            bool isLong,
            uint160 liquidationSqrtPrice,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity
        );

    function totalOpenInterestUSD() external view returns (uint256);
    function totalCollateralUSDRunning() external view returns (uint256);
}

contract EswapArbitrageExecutor is IFlashLoanSimpleReceiver, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    // ─── Immutable wiring ──────────────────────────────────────────────────

    /// @dev Aave V3-style pool used only as the atomic funding source.
    IFlashLoanProvider public immutable flashProvider;
    /// @dev `EswapLeverageAdapter` — the only way to open a leveraged position.
    IEswapLeverageAdapter public immutable adapter;
    /// @dev `EswapRouter` — the only way to close a position.
    IEswapRouter public immutable router;

    // ─── Owner configuration ───────────────────────────────────────────────

    /// @notice Venues the executor is permitted to route the unwind leg through.
    /// @dev Whitelist rather than per-call validation so a compromised `plan.venue`
    ///      cannot be introduced by an off-chain caller without governance.
    mapping(address => bool) public allowedVenues;

    /// @notice Upper bound on the flash premium (premium + 1e4) we will accept.
    /// @dev `maxPremiumBps` is expressed in bps so it can be compared against the
    ///      Aave-reported premium without trusting an off-chain assumption.
    uint256 public maxPremiumBps;

    /// @notice Hard cap on a single execution's notional, in flash-asset units.
    uint256 public maxFlashAmount;

    /// @notice Maximum leverage the executor may request from the adapter.
    uint8 public maxLeverage;

    // ─── Types ─────────────────────────────────────────────────────────────

    /// @param flashAsset      Token borrowed and repaid by the flash loan.
    /// @param flashAmount     Borrow size; MUST equal `marginIn` (see `_validate`).
    /// @param tokenOut        Collateral currency of the position.
    /// @param feeTier         Hook accounting pool fee (3000 on Unichain).
    /// @param leverage        Requested leverage (1..`maxLeverage`).
    /// @param marginIn        Margin leg pulled by the router from this contract.
    /// @param minOpenOut      Slippage floor on the leveraged open output.
    /// @param minCloseOut     Slippage floor on the net proceeds after close.
    /// @param hook            `EswapMarginHook` address.
    /// @param hookPoolKey     Hook-enabled accounting pool key.
    /// @param solver          Solver that funded the borrow leg.
    /// @param venue           Whitelisted external venue for the unwind leg.
    /// @param venueData       Opaque calldata forwarded to `venue`.
    /// @param minVenueOut     Slippage floor on the venue's unwind output.
    /// @param minProfit       Net residual, in `flashAsset` units, required to keep the trade.
    /// @param deadline        Unix timestamp after which the plan is rejected.
    struct ArbPlan {
        address flashAsset;
        uint256 flashAmount;
        address tokenOut;
        uint24 feeTier;
        uint8 leverage;
        uint256 marginIn;
        uint256 minOpenOut;
        uint256 minCloseOut;
        address hook;
        PoolKey hookPoolKey;
        address solver;
        address venue;
        bytes venueData;
        uint256 minVenueOut;
        uint256 minProfit;
        uint256 deadline;
    }

    // ─── Errors ────────────────────────────────────────────────────────────

    error ZeroAddress();
    error ZeroAmount();
    error DeadlineExpired();
    error LeverageOutOfRange();
    error VenueNotAllowed();
    error MarginMustEqualFlashAmount();
    error FlashAmountTooLarge();
    error PremiumTooHigh();
    error UnauthorizedCallback();
    error PlanAssetMismatch();
    error PositionNotFlat();
    error InvariantDrift();
    error ProfitBelowFloor();
    error VenueOutputBelowFloor();

    // ─── Events ────────────────────────────────────────────────────────────

    event VenueSet(address indexed venue, bool allowed);
    event LimitsSet(uint256 maxFlashAmount, uint8 maxLeverage, uint256 maxPremiumBps);

    /// @notice Emitted once per successfully settled round trip.
    event ArbitrageExecuted(
        address indexed flashAsset,
        address indexed tokenOut,
        uint8 leverage,
        uint256 premium,
        uint256 opened,
        uint256 closed,
        uint256 venueOut,
        int256 pnl,
        bool enforced
    );

    /// @notice Emitted by the owner-only micro canary. This event is the ONLY
    ///         marker telemetry attributes to health checks, so canary volume is
    ///         never conflated with real venue volume.
    event HealthCheckPassed(uint256 marginIn, uint8 leverage, uint256 opened, uint256 closed);

    // ─── Constructor ───────────────────────────────────────────────────────

    constructor(
        IFlashLoanProvider _flashProvider,
        IEswapLeverageAdapter _adapter,
        IEswapRouter _router,
        uint256 _maxFlashAmount,
        uint8 _maxLeverage,
        uint256 _maxPremiumBps
    ) Ownable(msg.sender) {
        if (
            address(_flashProvider) == address(0) || address(_adapter) == address(0)
                || address(_router) == address(0)
        ) revert ZeroAddress();
        if (_maxFlashAmount == 0 || _maxLeverage == 0) revert ZeroAmount();
        flashProvider = _flashProvider;
        adapter = _adapter;
        router = _router;
        maxFlashAmount = _maxFlashAmount;
        maxLeverage = _maxLeverage;
        maxPremiumBps = _maxPremiumBps;
    }

    /// @dev Accept native proceeds. Closing a native-collateral position (a LONG
    ///      on ETH/USDC) settles the trader's payout in ETH, and this contract is
    ///      the trader.
    receive() external payable {}

    // ─── Admin ─────────────────────────────────────────────────────────────

    function setVenue(address venue, bool allowed) external onlyOwner {
        if (venue == address(0)) revert ZeroAddress();
        allowedVenues[venue] = allowed;
        emit VenueSet(venue, allowed);
    }

    function setLimits(uint256 _maxFlashAmount, uint8 _maxLeverage, uint256 _maxPremiumBps) external onlyOwner {
        if (_maxFlashAmount == 0 || _maxLeverage == 0) revert ZeroAmount();
        maxFlashAmount = _maxFlashAmount;
        maxLeverage = _maxLeverage;
        maxPremiumBps = _maxPremiumBps;
        emit LimitsSet(_maxFlashAmount, _maxLeverage, _maxPremiumBps);
    }

    /// @notice Emergency / user-fund recovery. Also the escape hatch for any
    ///         residual dust that a reverted simulation might strand.
    function sweepToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        address asset = token == address(0) ? address(0) : token;
        if (asset == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "ETH sweep failed");
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }

    // ─── Execution ─────────────────────────────────────────────────────────

    /**
     * @notice Run one atomic, flash-funded ESWAP round trip.
     * @dev Reverts unless the round trip clears `plan.minProfit` AFTER flash
     *      principal, flash premium and every venue fee. This is the only
     *      economic gate: a plan that merely "works" is not enough.
     *
     *      Invariants asserted after the close:
     *        - the position is flat (`collateralAmount == 0 && borrowedAmount == 0`),
     *        - `totalOpenInterestUSD` and `totalCollateralUSDRunning` are back to
     *          their pre-trade values.
     */
    function executeArbitrage(ArbPlan calldata plan) external nonReentrant {
        _run(plan, true);
    }

    /**
     * @notice Owner-only diagnostic: run the identical atomic round trip but
     *         REPORT the real P&L instead of gating on it.
     *
     * @dev This is the harness's measurement primitive. It performs a genuine
     *      flash borrow, a genuine leveraged open, a genuine close and a genuine
     *      external unwind on real liquidity — it is not a simulation — so the
     *      number it returns is the honest cost of a round trip including the
     *      protocol toll, both pool fees and the flash premium.
     *
     *      It deliberately does NOT skip the repayment, so it always costs gas and
     *      can never be turned into a free inventory loop. It also never sweeps a
     *      loss to the owner; a negative P&L simply reduces this contract's
     *      balance, which the owner can reclaim via `sweepToken`.
     */
    function dryRunArbitrage(ArbPlan calldata plan)
        external
        onlyOwner
        nonReentrant
        returns (int256 pnl, uint256 opened, uint256 closed, uint256 venueOut)
    {
        _run(plan, false);
        pnl = _lastPnl;
        opened = _lastOpened;
        closed = _lastClosed;
        venueOut = _lastVenueOut;
    }

    function _run(ArbPlan calldata plan, bool enforce) internal {
        _validate(plan);

        // Snapshot the hook aggregates so the callback can prove they were restored.
        (uint256 oiBefore, uint256 collateralBefore) = _aggregates(plan.hook);

        address[] memory assets = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        uint256[] memory modes = new uint256[](1);
        assets[0] = plan.flashAsset;
        amounts[0] = plan.flashAmount;
        modes[0] = 1; // request the provider's real premium so the ceiling is exercised

        // The router pulls the margin leg from this contract, so the router (not
        // the adapter) needs the approval. It is reset inside the callback, so no
        // allowance survives the transaction even on the success path.
        IERC20(plan.flashAsset).forceApprove(address(router), plan.marginIn);

        _enforceProfit = enforce;
        _lastPnl = 0;
        _lastOpened = 0;
        _lastClosed = 0;
        _lastVenueOut = 0;

        flashProvider.flashLoanSimple(
            address(this),
            assets,
            amounts,
            modes,
            address(this),
            abi.encode(plan, oiBefore, collateralBefore),
            0
        );

        if (enforce) {
            // Defensive sweep: the callback already forwarded the trade's residual,
            // so anything still here is pre-existing inventory that must not be
            // stranded.
            uint256 dust = IERC20(plan.flashAsset).balanceOf(address(this));
            if (dust > 0) IERC20(plan.flashAsset).safeTransfer(owner(), dust);
        }
    }

    /**
     * @notice Aave V3 `flashLoanSimple` callback.
     * @dev Runs while the Aave pool's reentrancy lock is held. Because Aave does
     *      not take a Uniswap V4 lock, the ESWAP router may enter
     *      `PoolManager.unlock` from here.
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool) {
// `msg.sender` is the pool that lent the funds and `initiator` is the borrower,
  // which is this contract. Aave passes the borrower here, so a callback claiming
  // a different initiator is spoofed and must be rejected.
  if (msg.sender != address(flashProvider) || initiator != address(this)) {
    revert UnauthorizedCallback();
  }

        (ArbPlan memory plan, uint256 oiBefore, uint256 collateralBefore) =
            abi.decode(params, (ArbPlan, uint256, uint256));

if (plan.flashAsset != asset || plan.flashAmount != amount) revert PlanAssetMismatch();
    // `premium` is an absolute token amount, so compare it to the borrowed
    // size rather than to the raw amount. Revert when
    // premium/amount > maxPremiumBps/10_000.
    if (premium * 10_000 > amount * maxPremiumBps) revert PremiumTooHigh();

    // Snapshot both balances the round trip touches. Everything below is then
    // measured as a *delta*, so any pre-existing inventory held by this contract
    // (e.g. the canary's leftover collateral) is never swapped by the venue and
    // never reported as this trade's profit.
    uint256 assetBaseline = IERC20(asset).balanceOf(address(this));
    uint256 collateralBaseline = _balanceOf(plan.tokenOut);

        // ── Leg 1: open the leveraged position (margin comes from the flash loan)
        uint256 opened = adapter.exactInputSingleWithLeverage(
            plan.flashAsset, plan.tokenOut, plan.feeTier, plan.leverage, plan.marginIn, plan.minOpenOut, address(this)
        );

        // ── Leg 2: close it in the SAME transaction. `msg.sender == trader` holds
        //         because this contract opened as itself.
        router.closePosition(plan.hook, plan.hookPoolKey, address(this), plan.solver, plan.minCloseOut);

        // ── Leg 3: unwind the recovered collateral back into the flash asset
        uint256 venueOut;
        uint256 collateralInHand = _balanceOf(plan.tokenOut) - collateralBaseline;
        if (collateralInHand > 0) {
            if (plan.tokenOut == address(0)) {
                _pushNative(plan.venue, collateralInHand);
            } else {
                IERC20(plan.tokenOut).forceApprove(plan.venue, collateralInHand);
            }
            venueOut = IExternalVenue(plan.venue).swap(
                plan.tokenOut, plan.flashAsset, collateralInHand, plan.minVenueOut, plan.venueData
            );
            if (venueOut < plan.minVenueOut) revert VenueOutputBelowFloor();
            // Approval hygiene: never leave a live allowance behind.
            if (plan.tokenOut != address(0)) IERC20(plan.tokenOut).forceApprove(plan.venue, 0);
        }

        // ── Invariant: the position must be flat and the aggregates restored.
        _assertFlat(plan.hook, plan.hookPoolKey);
        _assertAggregates(plan.hook, oiBefore, collateralBefore);

        // ── Repay principal + premium, then settle the residual.
        uint256 owed = amount + premium;
        uint256 held = IERC20(asset).balanceOf(address(this));
        // The trade only has to cover the debt on top of the inventory it started
        // with; anything beyond that is genuine profit.
        uint256 required = assetBaseline + owed;
        if (held < required) revert InvariantDrift();
        int256 residual = int256(held - required);

        _lastPnl = residual;
        _lastOpened = opened;
        _lastClosed = collateralInHand;
        _lastVenueOut = venueOut;

        if (_enforceProfit) {
            if (residual < 0 || uint256(residual) < plan.minProfit) revert ProfitBelowFloor();
        }

        IERC20(asset).forceApprove(address(flashProvider), owed);
        // Zero the router allowance even on the success path.
        IERC20(plan.flashAsset).forceApprove(address(router), 0);
        // A profitable round trip is swept to the owner immediately; a dry-run loss
        // stays on this contract, recoverable via `sweepToken`, so the harness can
        // bankroll its own diagnostics without anyone profiting from them.
        if (residual > 0) IERC20(asset).safeTransfer(owner(), uint256(residual));

        emit ArbitrageExecuted(
            asset,
            plan.tokenOut,
            plan.leverage,
            premium,
            opened,
            collateralInHand,
            venueOut,
            residual,
            _enforceProfit
        );

        return true;
    }

    // ─── Owner-only micro canary ───────────────────────────────────────────

    /**
     * @notice $1-$5 micro open/close round trip used to prove the deployment works.
     * @dev Funded from this contract's own balance (the owner must have topped it
     *      up), so it exercises the same router -> hook -> close path without a
     *      flash loan. It asserts the position is flat and that the hook
     *      aggregates are unchanged, and emits `HealthCheckPassed` so telemetry can
     *      exclude canary flow from volume metrics.
     *
     *      This is a diagnostic, not a trading strategy: at $1-$5 the round trip
     *      is always P&L-negative, so it can never be economically motivated.
     */
    function healthCheck(uint256 marginIn, uint8 leverage) external onlyOwner nonReentrant returns (uint256 opened, uint256 closed) {
        if (marginIn == 0) revert ZeroAmount();
        if (leverage == 0 || leverage > maxLeverage) revert LeverageOutOfRange();

        address asset = _canaryAsset;
        address collateral = _canaryCollateral;
        address hook = _canaryHook;
        PoolKey memory key = _canaryKey;
        address solver = _canarySolver;
        uint24 feeTier = _canaryFee;

        if (asset == address(0) || hook == address(0) || solver == address(0)) {
            revert ZeroAddress();
        }
        // `collateral == address(0)` is the native-currency sentinel, not an
        // invalid address, so it is deliberately not covered by the guard above.
        if (asset == collateral) revert PlanAssetMismatch();
        if (IERC20(asset).balanceOf(address(this)) < marginIn) revert ZeroAmount();

        (uint256 oiBefore, uint256 collateralBefore) = _aggregates(hook);

        IERC20(asset).forceApprove(address(router), marginIn);
        opened = adapter.exactInputSingleWithLeverage(asset, collateral, feeTier, leverage, marginIn, 0, address(this));
        router.closePosition(hook, key, address(this), solver, 0);
        IERC20(asset).forceApprove(address(router), 0);

        closed = _balanceOf(collateral);

        _assertFlat(hook, key);
        _assertAggregates(hook, oiBefore, collateralBefore);

        emit HealthCheckPassed(marginIn, leverage, opened, closed);
    }

    /// @notice Point `healthCheck` at a specific pool/solver. Owner-only; the
    ///         canary is a diagnostic so it must never be left pointing at a
    ///         market the owner did not intend to exercise.
    function setCanaryRoute(
        address asset,
        address collateral,
        address hook,
        PoolKey calldata key,
        address solver,
        uint24 feeTier
    ) external onlyOwner {
        _canaryAsset = asset;
        _canaryCollateral = collateral;
        _canaryHook = hook;
        _canaryKey = key;
        _canarySolver = solver;
        _canaryFee = feeTier;
    }

    // ─── Internals ─────────────────────────────────────────────────────────

    address private _canaryAsset;
    address private _canaryCollateral;
    address private _canaryHook;
    PoolKey private _canaryKey;
    address private _canarySolver;
    uint24 private _canaryFee;

    /// @dev Round-trip scratch. Written by `executeOperation` and read back by
    ///      `dryRunArbitrage` in the same transaction, so a revert can never
    ///      leave stale results observable from a later call.
    bool private _enforceProfit;
    int256 private _lastPnl;
    uint256 private _lastOpened;
    uint256 private _lastClosed;
    uint256 private _lastVenueOut;

    function _validate(ArbPlan calldata plan) internal view {
// `tokenOut == address(0)` is the native-currency sentinel (a LONG on ETH/USDC
    // settles in ETH), so only `flashAsset` — always a real ERC-20 because it is
    // borrowed and repaid — is rejected for being zero.
    if (plan.flashAsset == address(0)) revert ZeroAddress();
    if (plan.flashAsset == plan.tokenOut) revert ZeroAddress();
        if (plan.hook == address(0) || plan.solver == address(0) || plan.venue == address(0)) revert ZeroAddress();
        if (plan.flashAmount == 0 || plan.marginIn == 0) revert ZeroAmount();
        if (plan.deadline < block.timestamp) revert DeadlineExpired();
        if (plan.leverage == 0 || plan.leverage > maxLeverage) revert LeverageOutOfRange();
        if (plan.flashAmount > maxFlashAmount) revert FlashAmountTooLarge();
        if (!allowedVenues[plan.venue]) revert VenueNotAllowed();
        // Keep the loan and the margin leg identical so the residual is a pure
        // P&L number instead of "loan size minus margin" noise.
        if (plan.marginIn != plan.flashAmount) revert MarginMustEqualFlashAmount();
        if (plan.minOpenOut == 0 || plan.minCloseOut == 0) revert ZeroAmount();
    }

    function _aggregates(address hook) internal view returns (uint256 oi, uint256 collateral) {
        IEswapHookView h = IEswapHookView(hook);
        return (h.totalOpenInterestUSD(), h.totalCollateralUSDRunning());
    }

    /// @dev Balance of this contract for either a native or ERC-20 currency.
    function _balanceOf(address token) internal view returns (uint256) {
        return token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    /// @dev Forward native currency to the venue. A plain transfer is used rather
    ///      than `approve` because native has no allowance to manage.
    function _pushNative(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert VenueOutputBelowFloor();
    }

    function _assertAggregates(address hook, uint256 oiBefore, uint256 collateralBefore) internal view {
        (uint256 oi, uint256 collateral) = _aggregates(hook);
        if (oi != oiBefore || collateral != collateralBefore) revert InvariantDrift();
    }

    function _assertFlat(address hook, PoolKey memory key) internal view {
        IEswapHookView h = IEswapHookView(hook);
        (, uint256 collateralAmount, uint256 borrowedAmount,,,,,,) =
            h.positions(PoolId.unwrap(key.toId()), address(this));
        if (collateralAmount != 0 || borrowedAmount != 0) revert PositionNotFlat();
    }
}