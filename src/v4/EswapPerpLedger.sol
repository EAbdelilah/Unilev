// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IPerpPriceFeed {
    /// @notice Fair/TWAP USD price of `token`, 18-decimal result.
    function getTwapPrice(address token) external view returns (uint256);
    /// @notice Timestamp of the last validated price update (for staleness).
    function getTwapPriceUpdatedAt(address token) external view returns (uint256);
}

interface IPerpPoolManager {
    function extsload(bytes32 slot) external view returns (bytes32);
}

import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";

/**
 * @title PerpLedger
 * @notice Synthetic 0%-interest perpetuals DEX on Uniswap V4 (dual-price model).
 *
 * @dev SETTLEMENT RULE (the one-way dependency that makes this safe):
 *      - fair value / P&L is derived ONLY from the TWAP price feed;
 *      - the live V4 pool spot price is used ONLY as a fast liquidation trigger
 *        and health gate, NEVER to compute a payout.
 *      An attacker can move the trigger, never the price you are paid.
 *
 * @dev Positions are pure ledger entries -> no flash accounting, no delta
 *      netting, so the real-PoolManager CurrencyNotSettled failure does not
 *      apply here.
 *
 * @dev All USD amounts are 18-decimal fixed point. Sizes are in token units
 *      (18-decimal scaled) derived from notional / entry TWAP.
 */
contract PerpLedger is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------
    error Paused();
    error NotWhitelisted();
    error InvalidWhitelist();
    error MinInitialMargin();
    error InvalidLeverage();
    error OldPrice();
    error InvalidOracle();
    error BelowMinimumPosition();
    error SlippageControl();
    error NotOpen();
    error AlreadyOpen();
    error OICapExceeded();
    error NoSurplus();
    error NotLiquidatable();
    error InvalidRate();
    error InvalidLiquidationFee();
    error InvalidInsuranceFee();
    error ZeroAmount();

    // ------------------------------------------------------------------
    // Configuration (immutable)
    // ------------------------------------------------------------------
    IERC20 public immutable marginToken;      // e.g., USDC
    IPerpPriceFeed public immutable twapFeed; // Chainlink-backed TWAP/USD feed
    IPerpPoolManager public immutable manager;
    PoolKey public spotKey;                  // live spot pool for the trigger
    address public immutable baseToken;      // the asset being traded (synthetic)

    uint256 public constant PRECISION = 1e18;
    uint256 public constant BP = 1e4;

    // ------------------------------------------------------------------
    // Owner-settable risk parameters
    // ------------------------------------------------------------------
    uint256 public maxLeverage = 5;              // in x (e.g., 5 = 5x)
    uint256 public maintenanceMarginBps = 1000;  // 10% of notional to stay alive
    uint256 public liquidationFeeBps = 200;      // liquidator cut on the position
    uint256 public insuranceFeeBps = 20;         // per-open sweep into insurance
    uint256 public minInitialMarginUsd = 100e18; // USD
    uint256 public minPositionUsd = 50e18;       // USD
    uint256 public maxOracleAge = 60;            // seconds
    bool public paused;

    // ------------------------------------------------------------------
    // State
    // ------------------------------------------------------------------
    struct Position {
        bool active;
        bool isLong;
        uint256 size;        // token units (18-dec), signedness via isLong
        uint256 entryPrice;  // TWAP at open (18-dec USD per token)
        uint256 marginUsd;   // trader margin in USD (18-dec) at open
        uint256 notionalUsd; // |size| * entryPrice
        uint256 lastUpdate;  // block.timestamp
    }

    mapping(address => Position) public positions;
    uint256 public totalOpenNotionalUsd; // open interest (USD)
    uint256 public oiCapUsd;             // max OI vs insurance growth (gating)
    uint256 public insuranceUsd;         // loss-bearing buffer

    mapping(address => bool) public whitelist;

    event Opened(address indexed trader, bool isLong, uint256 size, uint256 entryPrice, uint256 notionalUsd);
    event Settled(address indexed trader, bool isLong, uint256 pnlUsd, uint256 returnedUsd, uint256 insurancePaid);
    event Liquidated(address indexed trader, uint256 liquidatorUsd, uint256 insurancePaid);
    event InsuranceDeposit(address indexed from, uint256 usd);
    event PausedSet(bool paused);

    // ------------------------------------------------------------------
    // Modifiers
    // ------------------------------------------------------------------
    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier onlyWhitelisted(address trader) {
        if (!whitelist[trader] && trader != owner()) revert NotWhitelisted();
        _;
    }

    constructor(
        address _marginToken,
        address _twapFeed,
        address _manager,
        PoolKey memory _spotKey,
        address _baseToken
    ) Ownable(msg.sender) {
        if (_twapFeed == address(0) || _manager == address(0)) revert InvalidOracle();
        marginToken = IERC20(_marginToken);
        twapFeed = IPerpPriceFeed(_twapFeed);
        manager = IPerpPoolManager(_manager);
        spotKey = _spotKey;
        baseToken = _baseToken;
    }

    // ==================================================================
    // PRICE: dual-source
    // ==================================================================

    /// @notice Fair settlement price — TWAP ONLY (never spot).
    function _twapPrice(address token) internal view returns (uint256 price) {
        price = twapFeed.getTwapPrice(token);
        if (price == 0) revert InvalidOracle();
        uint256 updatedAt = twapFeed.getTwapPriceUpdatedAt(token);
        if (block.timestamp > updatedAt && block.timestamp - updatedAt > maxOracleAge) {
            revert OldPrice();
        }
    }

    /// @notice Live spot USD price of `baseToken` derived from the V4 pool
    ///         sqrtPriceX96, converted to USD via the quote token's TWAP.
    ///         Used ONLY for liquidation triggers, never for settlement.
    /// @dev Reads the REAL packed `_pools[id].slot0` from the PoolManager via
    ///      extsload at keccak256(abi.encode(id, uint256(0))) — the exact
    ///      storage slot the production PoolManager uses (same pattern as
    ///      EswapMarginHook._slot0).
    function _triggerSpotUsd() internal view returns (uint256 spotUsd) {
        PoolId id = spotKey.toId();
        bytes32 packed = manager.extsload(keccak256(abi.encode(id, uint256(0))));
        uint160 sqrtPriceX96 = uint160(uint256(packed));
        if (sqrtPriceX96 == 0) revert InvalidOracle();

        // price of currency1 in currency0, 18-decimal: (sqrtPriceX96/2^192)^2.
        // mulDiv avoids the uint256 overflow of squaring sqrtPriceX96 directly
        // (same pattern as EswapMarginHook's price derivation).
        uint256 price1in0 = _mulDiv(uint256(sqrtPriceX96) * 1e18, uint256(sqrtPriceX96), uint256(1) << 192);
        // USD value of currency0
        uint256 quoteUsd = _twapPrice(Currency.unwrap(spotKey.currency0));
        spotUsd = (price1in0 * quoteUsd) / PRECISION;
    }

    /// @dev Health price: min(spot, twap) for longs, max(spot, twap) for shorts
    ///      (belt-and-suspenders: the position dies when EITHER indicator is underwater).
    function _healthPrice(bool isLong) internal view returns (uint256) {
        uint256 twap = _twapPrice(baseToken);
        uint256 spot = _triggerSpotUsd();
        return isLong ? (spot < twap ? spot : twap) : (spot > twap ? spot : twap);
    }

    // ==================================================================
    // OPEN
    // ==================================================================

    /**
     * @notice Open a synthetic position. Margin is pulled from the trader in
     *         `marginToken` and converted to USD at the TWAP entry price.
     * @dev Notional = marginUsd * leverage. Size (token units) = notional / entry.
     */
    function open(bool isLong, uint256 leverage, uint256 toMarginTokens)
        external
        nonReentrant
        whenNotPaused
        onlyWhitelisted(msg.sender)
    {
        if (positions[msg.sender].active) revert AlreadyOpen();
        if (leverage == 0 || leverage > maxLeverage) revert InvalidLeverage();

        uint256 entryPrice = _twapPrice(baseToken);
        uint256 marginTokens = toMarginTokens;

        // Value the margin in USD at the MARGIN TOKEN's own price (not the base token's).
        uint256 marginUsd = _toUsd(marginTokens, _twapPrice(address(marginToken)));
        if (marginUsd < minInitialMarginUsd) revert MinInitialMargin();

        uint256 notionalUsd = marginUsd * leverage; // marginUsd is already PRECISION-scaled
        if (notionalUsd < minPositionUsd) revert BelowMinimumPosition();
        if (totalOpenNotionalUsd + notionalUsd > oiCapUsd) revert OICapExceeded();

        uint256 insuranceFee = (notionalUsd * insuranceFeeBps) / BP;
        // Collect the insurance fee in REAL margin tokens (fee is a small % of
        // notional); without this the pool is an accounting number with no
        // token backing and cannot absorb losses.
        uint256 insuranceFeeTokens = (insuranceFee * PRECISION) / _twapPrice(address(marginToken));
        insuranceUsd += insuranceFee;

        uint256 size = (notionalUsd * PRECISION) / entryPrice;

        positions[msg.sender] = Position({
            active: true,
            isLong: isLong,
            size: size,
            entryPrice: entryPrice,
            marginUsd: marginUsd,
            notionalUsd: notionalUsd,
            lastUpdate: block.timestamp
        });
        totalOpenNotionalUsd += notionalUsd;

        marginToken.safeTransferFrom(msg.sender, address(this), marginTokens + insuranceFeeTokens);

        emit Opened(msg.sender, isLong, size, entryPrice, notionalUsd);
    }

    // ==================================================================
    // SETTLE (close) — TWAP-based P&L
    // ==================================================================

    /**
     * @notice Close a position. P&L is settled at the CURRENT TWAP (fair value).
     * @dev The trader receives equity back in margin tokens; insurance covers any
     *      shortfall (equity below the liquidation level has already been caught
     *      by the spot trigger).
     */
    function settle(uint256 minOutTokens, uint256 maxOutTokens)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 pnlUsd, uint256 returnedTokens)
    {
        Position memory pos = positions[msg.sender];
        if (!pos.active) revert NotOpen();

        uint256 exitPrice = _twapPrice(baseToken);
        // SIGNED P&L: losses realize here (they must not be clamped to zero).
        int256 pnl = _pnlAt(pos, exitPrice);
        uint256 pnlUsd = pnl > 0 ? uint256(pnl) : 0;
        int256 equity = int256(pos.marginUsd) + pnl;

        // Insurance absorbs only when equity < margin (unrealized loss realized).
        uint256 insuranceUsed = 0;
        if (equity < 0) {
            insuranceUsed = uint256(-equity);
            insuranceUsd = insuranceUsd > insuranceUsed ? insuranceUsd - insuranceUsed : 0;
            equity = 0;
        } else if (equity < int256(pos.marginUsd)) {
            insuranceUsed = pos.marginUsd - uint256(equity);
            insuranceUsd = insuranceUsd > insuranceUsed ? insuranceUsd - insuranceUsed : 0;
        }

        uint256 outTokens = (uint256(equity) * PRECISION) / _twapPrice(address(marginToken));
        if (outTokens < minOutTokens || outTokens > maxOutTokens) revert SlippageControl();

        _deletePosition(msg.sender);
        if (outTokens > 0) {
            marginToken.safeTransfer(msg.sender, outTokens);
        }

        return (pnlUsd, outTokens);
    }

    // ==================================================================
    // LIQUIDATION — spot TRIGGER, TWAP settle
    // ==================================================================

    /**
     * @notice Keeper liquidation. Triggered by the LIVE SPOT price (fast), then
     *         closed and settled at TWAP (fair). Reward paid in margin tokens.
     */
    function liquidate(address trader, uint256 minLiquidatorTokens)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 liquidatorTokens)
    {
        Position memory pos = positions[trader];
        if (!pos.active) revert NotOpen();
        if (!_isLiquidatable(pos)) revert NotLiquidatable();

        uint256 exitPrice = _twapPrice(baseToken);
        // SIGNED P&L so liquidation realizes the loss on the margin, not full value.
        int256 pnl = _pnlAt(pos, exitPrice);
        int256 equity = int256(pos.marginUsd) + pnl;

        // Insurance covers any shortfall below zero on the liquidation.
        if (equity < 0) {
            uint256 shortfall = uint256(-equity);
            insuranceUsd = insuranceUsd > shortfall ? insuranceUsd - shortfall : 0;
            equity = 0;
        }

        // liquidator fee + insurance sweep on the remaining equity
        uint256 liqFeeUsd = (uint256(equity) * liquidationFeeBps) / BP;
        insuranceUsd += (uint256(equity) * insuranceFeeBps) / BP;

        _deletePosition(trader);

        uint256 liqTokens = (liqFeeUsd * PRECISION) / _twapPrice(address(marginToken));
        if (liqTokens < minLiquidatorTokens) revert SlippageControl();
        marginToken.safeTransfer(msg.sender, liqTokens);

        emit Liquidated(trader, liqFeeUsd, insuranceUsd);
        return liqTokens;
    }

    /// @notice Trigger check: equity computed at the HEALTH price (spot-aware).
    function isLiquidatable(address trader) external view returns (bool) {
        Position memory pos = positions[trader];
        if (!pos.active) return false;
        return _isLiquidatable(pos);
    }

    function _isLiquidatable(Position memory pos) internal view returns (bool) {
        uint256 health = _healthPrice(pos.isLong);
        int256 pnl = _pnlAt(pos, health);
        int256 equity = int256(pos.marginUsd) + pnl;
        uint256 maintMargin = (pos.notionalUsd * maintenanceMarginBps) / BP;
        return equity <= int256(maintMargin);
    }

    // ==================================================================
    // INTERNAL
    // ==================================================================

    function _pnlAt(Position memory pos, uint256 price) internal pure returns (int256) {
        int256 delta;
        if (pos.isLong) {
            delta = price > pos.entryPrice ? int256(price - pos.entryPrice) : -int256(pos.entryPrice - price);
        } else {
            delta = pos.entryPrice > price ? int256(pos.entryPrice - price) : -int256(price - pos.entryPrice);
        }
        return (delta * int256(pos.size)) / int256(PRECISION);
    }

    function _toUsd(uint256 tokenAmount, uint256 price) internal pure returns (uint256) {
        return (tokenAmount * price) / PRECISION;
    }

    /// @dev Full-precision multiply-divide: (a*b)/denominator without overflow.
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        return Math.mulDiv(a, b, denominator);
    }

    function _deletePosition(address trader) internal {
        totalOpenNotionalUsd = totalOpenNotionalUsd > positions[trader].notionalUsd
            ? totalOpenNotionalUsd - positions[trader].notionalUsd
            : 0;
        delete positions[trader];
    }

    // ==================================================================
    // ADMIN / VIEW
    // ==================================================================

    function setMaxLeverage(uint256 x) external onlyOwner { if (x == 0) revert InvalidLeverage(); maxLeverage = x; }
    function setMaintenanceMarginBps(uint256 bps) external onlyOwner { if (bps == 0 || bps >= BP) revert InvalidRate(); maintenanceMarginBps = bps; }
    function setLiquidationFeeBps(uint256 bps) external onlyOwner { if (bps > 5000) revert InvalidLiquidationFee(); liquidationFeeBps = bps; }
    function setInsuranceFeeBps(uint256 bps) external onlyOwner { if (bps > 1000) revert InvalidInsuranceFee(); insuranceFeeBps = bps; }
    function setMinInitialMarginUsd(uint256 usd) external onlyOwner { minInitialMarginUsd = usd; }
    function setOICapUsd(uint256 usd) external onlyOwner { oiCapUsd = usd; }
    function setMaxOracleAge(uint256 s) external onlyOwner { maxOracleAge = s; }
    function setPaused(bool p) external onlyOwner { paused = p; emit PausedSet(p); }

    function setWhitelist(address trader, bool ok) external onlyOwner {
        if (trader == address(0)) revert InvalidWhitelist();
        whitelist[trader] = ok;
    }

    /// @notice Fund the counterparty/Takaful pool: anyone may deposit margin
    ///         tokens; the pool backs winners' payouts and absorbs socialized
    ///         losses. REAL token backing (not an accounting number).
    function depositInsurance(uint256 marginTokens)
        external
        nonReentrant
        whenNotPaused
    {
        if (marginTokens == 0) revert ZeroAmount();
        marginToken.safeTransferFrom(msg.sender, address(this), marginTokens);
        uint256 usd = (marginTokens * _twapPrice(address(marginToken))) / PRECISION;
        insuranceUsd += usd;
        emit InsuranceDeposit(msg.sender, usd);
    }

    /// @notice Owner withdraws ONLY surplus above the OI-based safety floor.
    function withdrawInsuranceSurplus() external onlyOwner nonReentrant {
        // keep at least 15% of open notional (Phase-2 gate)
        uint256 floor = (totalOpenNotionalUsd * 15) / 100;
        if (insuranceUsd <= floor) revert NoSurplus();
        uint256 surplus = insuranceUsd - floor;
        insuranceUsd -= surplus;
        marginToken.safeTransfer(msg.sender, (surplus * PRECISION) / _twapPrice(address(marginToken)));
    }

    function positionOf(address trader) external view returns (Position memory) {
        return positions[trader];
    }

    function marginTokenBalance() external view returns (uint256) {
        return marginToken.balanceOf(address(this));
    }
}
