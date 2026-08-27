// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IPriceFeed {
    function getTwapPrice(address token) external view returns (uint256);
}

/**
 * @title ArbunPutOption
 * @notice A 100% Shariah-compliant "Halal Short" option contract based on the Arbun (downpayment) principle.
 *
 * Shariah Compliance Architecture:
 * 1. No "Selling What You Do Not Own": Short traders do not borrow or sell assets on day one. Instead,
 *    they pay a non-refundable downpayment (Arbun) to lock in the right to sell the underlying asset
 *    (e.g., WETH) at a guaranteed strike price in the future.
 *    To exercise and lock profit, the trader MUST first purchase the WETH on the spot market and physically
 *    deliver the WETH to the contract, thereby establishing physical ownership and possession before execution.
 * 2. No Interest (Riba-Free): There is no leverage borrowing or compounding interest rates. Instead, the
 *    trader pays a one-time flat/percentage Administrative Booking and Price-Guarantee Fee (Ujrah),
 *    which is fully permissible under Islamic jurisprudence.
 * 3. Takaful Mutual Fund: Forfeited downpayments from canceled/expired contracts are kept by the protocol and
 *    pooled into a shared Takaful Mutual Fund. Successful options are paid out collaboratively from this
 *    forfeited-downpayment pool, ensuring self-funded solvency without debt or external financing.
 */
contract ArbunPutOption {
    using SafeERC20 for IERC20;

    struct Option {
        uint256 id;
        address trader;
        address underlyingToken; // e.g., WETH
        address collateralToken; // e.g., USDC
        uint256 downpayment; // Non-refundable Arbun deposit
        uint256 quantity; // Quantity of underlying asset to sell (e.g., 1 ether)
        uint256 lockedPrice; // Strike price normalized to 18 decimals (WETH/USD price)
        uint256 expiration; // Expiration timestamp
        uint256 ujrahFee; // One-time administrative booking fee (Riba-free)
        bool isActive;
        bool exercised;
        bool canceled;
    }

    IPriceFeed public immutable priceFeed;
    address public owner;
    uint256 public optionIdCounter;

    // Takaful Mutual Fund tracking: token address => pooled balance
    mapping(address => uint256) public takafulFund;
    // Collected Ujrah service fees: token address => fee balance
    mapping(address => uint256) public ujrahCollected;
    // All options mapped by their ID
    mapping(uint256 => Option) public options;

    // Shariah parameters (can be configured by owner)
    uint256 public constant BPS_DIVISOR = 10000;
    uint256 public ujrahFeeBps = 100; // Default: 1.00% booking fee
    uint256 public minDownpaymentBps = 1000; // Default: 10% minimum downpayment on option size

    event OptionOpened(
        uint256 indexed id,
        address indexed trader,
        address indexed underlyingToken,
        address collateralToken,
        uint256 downpayment,
        uint256 quantity,
        uint256 lockedPrice,
        uint256 ujrahFee,
        uint256 expiration
    );

    event OptionExercised(
        uint256 indexed id, address indexed trader, uint256 quantityDelivered, uint256 strikePayout, uint256 netProfit
    );

    event OptionCanceled(uint256 indexed id, address indexed trader, uint256 forfeitedDownpayment);

    event TakafulFundSeeded(address indexed token, uint256 amount);
    event UjrahFeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event ShariahConfigUpdated(uint256 ujrahBps, uint256 minDownpaymentBps);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _priceFeed) {
        require(_priceFeed != address(0), "Invalid price feed address");
        priceFeed = IPriceFeed(_priceFeed);
        owner = msg.sender;
    }

    function setOwner(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    function configureShariahParams(uint256 _ujrahFeeBps, uint256 _minDownpaymentBps) external onlyOwner {
        require(_ujrahFeeBps <= 500, "Ujrah fee cannot exceed 5%");
        require(_minDownpaymentBps >= 500 && _minDownpaymentBps <= 5000, "Min downpayment must be 5% to 50%");
        ujrahFeeBps = _ujrahFeeBps;
        minDownpaymentBps = _minDownpaymentBps;
        emit ShariahConfigUpdated(_ujrahFeeBps, _minDownpaymentBps);
    }

    /**
     * @notice Open a Shariah-compliant Halal Put Option (Halal Short) using the Arbun principle.
     * @param underlyingToken The asset to short (e.g., WETH)
     * @param collateralToken The stablecoin/payment asset (e.g., USDC)
     * @param quantity The quantity of underlying asset (e.g., 1 WETH)
     * @param duration Duration of the price guarantee service in seconds
     */
    function openHalalShort(address underlyingToken, address collateralToken, uint256 quantity, uint256 duration)
        external
        returns (uint256 optionId)
    {
        require(underlyingToken != address(0), "Invalid underlying");
        require(collateralToken != address(0), "Invalid collateral");
        require(quantity > 0, "Quantity must be greater than zero");
        require(duration >= 1 hours && duration <= 30 days, "Duration must be between 1h and 30d");

        // Fetch spot price from PriceFeed (normalized to 18 decimals)
        uint256 currentPrice = priceFeed.getTwapPrice(underlyingToken);
        require(currentPrice > 0, "Invalid price from feed");

        // Calculate option notional size in collateral value (assuming collateral is stablecoin USD)
        uint256 notionalCollateralValue = (quantity * currentPrice) / 1e18;

        // Calculate downpayment requirement (Arbun) and booking fee (Ujrah)
        uint256 requiredDownpayment = (notionalCollateralValue * minDownpaymentBps) / BPS_DIVISOR;
        uint256 ujrahFee = (notionalCollateralValue * ujrahFeeBps) / BPS_DIVISOR;

        // Collect funds from trader
        uint256 totalCollect = requiredDownpayment + ujrahFee;
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), totalCollect);

        // Track administrative fee
        ujrahCollected[collateralToken] += ujrahFee;

        // Register option
        optionIdCounter++;
        optionId = optionIdCounter;

        options[optionId] = Option({
            id: optionId,
            trader: msg.sender,
            underlyingToken: underlyingToken,
            collateralToken: collateralToken,
            downpayment: requiredDownpayment,
            quantity: quantity,
            lockedPrice: currentPrice,
            expiration: block.timestamp + duration,
            ujrahFee: ujrahFee,
            isActive: true,
            exercised: false,
            canceled: false
        });

        emit OptionOpened(
            optionId,
            msg.sender,
            underlyingToken,
            collateralToken,
            requiredDownpayment,
            quantity,
            currentPrice,
            ujrahFee,
            block.timestamp + duration
        );
    }

    /**
     * @notice Exercise the Halal Put Option.
     * @dev To comply with "No selling what you do not own", the trader must physically
     *      possess and transfer the quantity of WETH (underlying) to the contract.
     *      The contract buys it at the lockedPrice, paying out the trader the full lockedValue.
     */
    function exerciseHalalShort(uint256 optionId) external {
        Option storage opt = options[optionId];
        require(opt.isActive, "Option is not active");
        require(msg.sender == opt.trader, "Only option trader can exercise");
        require(block.timestamp <= opt.expiration, "Option is expired");

        uint256 currentPrice = priceFeed.getTwapPrice(opt.underlyingToken);
        require(currentPrice > 0, "Invalid price feed reading");
        require(currentPrice < opt.lockedPrice, "Price has not fallen (no profit)");

        // Total locked sell price value in collateral equivalent
        uint256 notionalCollateralValue = (opt.quantity * opt.lockedPrice) / 1e18;
        // Current spot purchase value of underlying
        uint256 currentSpotValue = (opt.quantity * currentPrice) / 1e18;

        // Net profit calculation = locked value - spot value - downpayment
        require(
            notionalCollateralValue > currentSpotValue + opt.downpayment,
            "Exercise yields no net profit after downpayment"
        );
        uint256 netProfit = notionalCollateralValue - currentSpotValue - opt.downpayment;

        // 1. Establish Physical Possession: Trader transfers the underlying asset to the contract
        IERC20(opt.underlyingToken).safeTransferFrom(msg.sender, address(this), opt.quantity);

        // 2. Settlement Payout: DEX buys the underlying from the trader at the locked price.
        //    The total payout is the full locked value (notionalCollateralValue).
        //    The required USDC that the Takaful Fund must temporarily cover is:
        //    notionalCollateralValue - downpayment.
        uint256 takafulRequired = notionalCollateralValue - opt.downpayment;
        require(takafulFund[opt.collateralToken] >= takafulRequired, "Insufficient funds in Takaful Mutual Fund");

        // Deduct the required amount from the shared Takaful Mutual Fund
        takafulFund[opt.collateralToken] -= takafulRequired;

        // Mark option completed
        opt.isActive = false;
        opt.exercised = true;

        // Transfer full strike payout (notionalCollateralValue) in collateral token to the trader
        IERC20(opt.collateralToken).safeTransfer(msg.sender, notionalCollateralValue);

        emit OptionExercised(optionId, msg.sender, opt.quantity, notionalCollateralValue, netProfit);
    }

    /**
     * @notice Cancel/expire the Halal Put Option.
     * @dev If the price goes up (loss) or the contract expires, the trader decides not to sell.
     *      The non-refundable downpayment (Arbun) is kept and deposited into the shared Takaful Fund
     *      to cover other traders' winnings.
     */
    function cancelHalalShort(uint256 optionId) external {
        Option storage opt = options[optionId];
        require(opt.isActive, "Option is not active");
        // Can be canceled by the trader anytime, or by anyone if expired
        if (msg.sender != opt.trader) {
            require(block.timestamp > opt.expiration, "Only option trader can cancel before expiration");
        }

        // Keep downpayment and move to the collaborative Takaful Mutual Fund
        takafulFund[opt.collateralToken] += opt.downpayment;

        opt.isActive = false;
        opt.canceled = true;

        emit OptionCanceled(optionId, opt.trader, opt.downpayment);
    }

    /**
     * @notice Seed the shared Takaful Mutual Fund with collateral tokens to support solvency.
     */
    function seedTakafulFund(address collateralToken, uint256 amount) external {
        require(collateralToken != address(0), "Invalid collateral token");
        require(amount > 0, "Amount must be greater than zero");

        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), amount);
        takafulFund[collateralToken] += amount;

        emit TakafulFundSeeded(collateralToken, amount);
    }

    /**
     * @notice Withdraw delivered underlying tokens from the contract to be sold on the spot market.
     * @dev Restricted to onlyOwner. The proceeds can be deposited back to the Takaful Fund via seedTakafulFund.
     */
    function withdrawUnderlying(address token, address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        IERC20(token).safeTransfer(recipient, amount);
    }

    /**
     * @notice Swap delivered underlying tokens for collateral and replenish the Takaful Fund.
     * @dev Allows the owner to directly replenish the Takaful pool of a collateral token.
     */
    function replenishTakafulFundWithUnderlying(
        address underlyingToken,
        address collateralToken,
        uint256 underlyingAmount,
        uint256 receivedCollateral
    ) external onlyOwner {
        require(underlyingToken != address(0), "Invalid underlying token");
        require(collateralToken != address(0), "Invalid collateral token");
        require(underlyingAmount > 0, "Amount must be greater than zero");

        // The owner transfers the swapped collateral to the contract
        IERC20(collateralToken).safeTransferFrom(msg.sender, address(this), receivedCollateral);
        takafulFund[collateralToken] += receivedCollateral;

        emit TakafulFundSeeded(collateralToken, receivedCollateral);
    }

    /**
     * @notice Withdraw collected Riba-free Ujrah administrative booking fees.
     */
    function withdrawUjrahFees(address collateralToken, address recipient, uint256 amount) external onlyOwner {
        require(recipient != address(0), "Invalid recipient");
        require(amount <= ujrahCollected[collateralToken], "Insufficient Ujrah balance");

        ujrahCollected[collateralToken] -= amount;
        IERC20(collateralToken).safeTransfer(recipient, amount);

        emit UjrahFeesWithdrawn(collateralToken, recipient, amount);
    }
}
