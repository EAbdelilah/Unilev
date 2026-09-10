// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArbunPutOption} from "../../src/v4/ArbunPutOption.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {
        _mint(msg.sender, 1_000_000 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PriceFeedMock {
    mapping(address => uint256) public prices;

    function setPrice(address token, uint256 price) external {
        prices[token] = price;
    }

    function getTwapPrice(address token) external view returns (uint256) {
        return prices[token] > 0 ? prices[token] : 1e18;
    }

    // Mirrors PriceFeed.getAmountInUsd for 18-decimal tokens (the test mocks
    // WETH/USDC are both 18-dec): USD = raw_amount * price18 / 1e18.
    function getAmountInUsd(address token, uint256 amount) external view returns (uint256) {
        return (prices[token] > 0 ? prices[token] : 1e18) * amount / 1e18;
    }
}

contract ArbunPutOptionTest is Test {
    ArbunPutOption public optionContract;
    PriceFeedMock public priceFeed;
    ERC20Mock public weth;
    ERC20Mock public usdc;

    address public owner = address(0xAA);
    address public trader = address(0xBB);
    address public provider = address(0xCC);

    function setUp() public {
        priceFeed = new PriceFeedMock();
        weth = new ERC20Mock("Wrapped Ether", "WETH");
        usdc = new ERC20Mock("USD Coin", "USDC");

        vm.prank(owner);
        optionContract = new ArbunPutOption(address(priceFeed));
    }

    function test_ShariahParamsInitialization() public {
        assertEq(optionContract.owner(), owner);
        assertEq(optionContract.ujrahFeeBps(), 100);
        assertEq(optionContract.minDownpaymentBps(), 1000);
    }

    function test_ConfigureShariahParams_Success() public {
        vm.prank(owner);
        optionContract.configureShariahParams(200, 1500);
        assertEq(optionContract.ujrahFeeBps(), 200);
        assertEq(optionContract.minDownpaymentBps(), 1500);
    }

    function test_ConfigureShariahParams_RevertIfNotOwner() public {
        vm.expectRevert();
        optionContract.configureShariahParams(200, 1500);
    }

    function test_ConfigureShariahParams_RevertIfInvalid() public {
        vm.prank(owner);
        vm.expectRevert("Ujrah fee cannot exceed 5%");
        optionContract.configureShariahParams(600, 1500);

        vm.prank(owner);
        vm.expectRevert("Min downpayment must be 5% to 50%");
        optionContract.configureShariahParams(200, 400);

        vm.prank(owner);
        vm.expectRevert("Min downpayment must be 5% to 50%");
        optionContract.configureShariahParams(200, 6000);
    }

    function test_OpenHalalShort_Success() public {
        // Set WETH spot price to $3,000 (18 decimals)
        priceFeed.setPrice(address(weth), 3000 * 1e18);

        // Notional value of 1 WETH at $3000 = $3000 USDC
        // Required downpayment (Arbun) = 10% = 300 USDC
        // Administrative fee (Ujrah) = 1% = 30 USDC
        // Total required = 330 USDC

        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);

        uint256 optionId = optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);
        vm.stopPrank();

        assertEq(optionId, 1);
        assertEq(usdc.balanceOf(trader), 0);
        assertEq(usdc.balanceOf(address(optionContract)), totalCollect);
        assertEq(optionContract.ujrahCollected(address(usdc)), 30 ether);

        (
            uint256 id,
            address oTrader,
            address oUnderlying,
            address oCollateral,
            uint256 oDownpayment,
            uint256 oQuantity,
            uint256 oLockedPrice,
            uint256 oExpiration,
            uint256 oUjrahFee,
            bool isActive,
            bool exercised,
            bool canceled
        ) = optionContract.options(optionId);

        assertEq(id, 1);
        assertEq(oTrader, trader);
        assertEq(oUnderlying, address(weth));
        assertEq(oCollateral, address(usdc));
        assertEq(oDownpayment, 300 ether);
        assertEq(oQuantity, 1 ether);
        assertEq(oLockedPrice, 3000 * 1e18);
        assertEq(oExpiration, block.timestamp + 1 days);
        assertEq(oUjrahFee, 30 ether);
        assertTrue(isActive);
        assertFalse(exercised);
        assertFalse(canceled);
    }

    function test_ExerciseHalalShort_Success() public {
        // 1. Open Halal Put Option at $3,000 strike price
        priceFeed.setPrice(address(weth), 3000 * 1e18);
        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);
        uint256 optionId = optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);
        vm.stopPrank();

        // 2. Seed the collaborative Takaful Mutual Fund to ensure solvency for payouts
        uint256 seedAmt = 10000 ether;
        usdc.mint(provider, seedAmt);
        vm.startPrank(provider);
        usdc.approve(address(optionContract), seedAmt);
        optionContract.seedTakafulFund(address(usdc), seedAmt);
        vm.stopPrank();

        assertEq(optionContract.takafulFund(address(usdc)), seedAmt);

        // 3. Price drops to $2,000 (Halal Profit scenario)
        //    Locked price = $3000, current price = $2000.
        //    Trader purchases WETH at $2000 spot (physical possession achieved)
        //    Trader delivers 1 WETH to DEX.
        //    DEX buys 1 WETH at $3000 (the locked strike price).
        //    Total payout to trader = $3000 USDC.
        priceFeed.setPrice(address(weth), 2000 * 1e18);

        weth.mint(trader, 1 ether);

        vm.startPrank(trader);
        weth.approve(address(optionContract), 1 ether);
        optionContract.exerciseHalalShort(optionId);
        vm.stopPrank();

        // Verify Trader balances
        assertEq(weth.balanceOf(trader), 0, "WETH delivered (physical possession proven)");
        assertEq(usdc.balanceOf(trader), 3000 ether, "Trader received full strike payout ($3,000)");

        // Verify Option state
        (,,,,,,,,, bool isActive, bool exercised, bool canceled) = optionContract.options(optionId);
        assertFalse(isActive);
        assertTrue(exercised);
        assertFalse(canceled);

        // Verify Contract balances
        assertEq(weth.balanceOf(address(optionContract)), 1 ether, "Contract holds the physically delivered WETH");
        // Takaful Fund provided: strike payout ($3000) - downpayment ($300) = $2700.
        assertEq(
            optionContract.takafulFund(address(usdc)), seedAmt - 2700 ether, "Takaful fund deducted correctly by $2,700"
        );
    }

    function test_CancelHalalShort_Success() public {
        // Open Halal Put Option
        priceFeed.setPrice(address(weth), 3000 * 1e18);
        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);
        uint256 optionId = optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);

        // Price rises or trader decides to cancel (Halal Loss scenario)
        // Under Shariah Arbun law, trader forfeits the non-refundable downpayment
        optionContract.cancelHalalShort(optionId);
        vm.stopPrank();

        // Verify Option state
        (,,,,,,,,, bool isActive, bool exercised, bool canceled) = optionContract.options(optionId);
        assertFalse(isActive);
        assertFalse(exercised);
        assertTrue(canceled);

        // Downpayment is sent to the shared Takaful Mutual Fund to cover locked-price risk
        assertEq(optionContract.takafulFund(address(usdc)), 300 ether);
    }

    function test_CancelHalalShort_Expired_ByAnyone() public {
        priceFeed.setPrice(address(weth), 3000 * 1e18);
        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);
        uint256 optionId = optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);
        vm.stopPrank();

        // Try to cancel by someone else before expiration -> should fail
        vm.prank(provider);
        vm.expectRevert("Only option trader can cancel before expiration");
        optionContract.cancelHalalShort(optionId);

        // Fast forward 2 days (expired)
        skip(2 days);

        // Anyone can cancel now to move funds to Takaful pool
        vm.prank(provider);
        optionContract.cancelHalalShort(optionId);

        (,,,,,,,,, bool isActive,, bool canceled) = optionContract.options(optionId);
        assertFalse(isActive);
        assertTrue(canceled);
        assertEq(optionContract.takafulFund(address(usdc)), 300 ether);
    }

    function test_WithdrawUnderlying_Success() public {
        priceFeed.setPrice(address(weth), 3000 * 1e18);
        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);
        uint256 optionId = optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);
        vm.stopPrank();

        // Seed Takaful fund
        usdc.mint(provider, 10000 ether);
        vm.prank(provider);
        usdc.approve(address(optionContract), 10000 ether);
        vm.prank(provider);
        optionContract.seedTakafulFund(address(usdc), 10000 ether);

        // Exercise to deliver 1 WETH to the contract
        priceFeed.setPrice(address(weth), 2000 * 1e18);
        weth.mint(trader, 1 ether);
        vm.startPrank(trader);
        weth.approve(address(optionContract), 1 ether);
        optionContract.exerciseHalalShort(optionId);
        vm.stopPrank();

        // Verify contract holds 1 WETH
        assertEq(weth.balanceOf(address(optionContract)), 1 ether);

        // Owner withdraws the delivered WETH to liquidate/sell on spot market
        address liquidatorRecipient = address(0xDDEE);
        vm.prank(owner);
        optionContract.withdrawUnderlying(address(weth), liquidatorRecipient, 1 ether);

        // WETH has been safely recovered! No longer trapped in contract!
        assertEq(weth.balanceOf(liquidatorRecipient), 1 ether);
        assertEq(weth.balanceOf(address(optionContract)), 0);
    }

    function test_ReplenishTakaful_Success() public {
        // Owner replenishes Takaful fund with USDC from sold/liquidated underlying WETH
        uint256 replenishAmt = 2000 ether;
        usdc.mint(owner, replenishAmt);

        vm.startPrank(owner);
        usdc.approve(address(optionContract), replenishAmt);
        optionContract.replenishTakafulFundWithUnderlying(address(weth), address(usdc), 1 ether, replenishAmt);
        vm.stopPrank();

        assertEq(optionContract.takafulFund(address(usdc)), replenishAmt);
    }

    function test_WithdrawUjrahFees_Success() public {
        priceFeed.setPrice(address(weth), 3000 * 1e18);
        uint256 totalCollect = 330 ether;
        usdc.mint(trader, totalCollect);

        vm.startPrank(trader);
        usdc.approve(address(optionContract), totalCollect);
        optionContract.openHalalShort(address(weth), address(usdc), 1 ether, 1 days);
        vm.stopPrank();

        uint256 feeAmt = optionContract.ujrahCollected(address(usdc));
        assertEq(feeAmt, 30 ether);

        address feeRecipient = address(0xDD);
        vm.prank(owner);
        optionContract.withdrawUjrahFees(address(usdc), feeRecipient, feeAmt);

        assertEq(usdc.balanceOf(feeRecipient), feeAmt);
        assertEq(optionContract.ujrahCollected(address(usdc)), 0);
    }
}
