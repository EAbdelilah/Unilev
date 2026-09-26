// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Minimal ERC-20 for settler unit tests only. This repo's OpenZeppelin and
 *      solmate ERC20 are both `abstract` (no MockERC20 exists by project design),
 *      and these are pure logic tests that must run without a fork, so a
 *      test-scoped token is required. It is never deployed by any deploy script
 *      and no protocol contract references it.
 */
contract TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}
import {IReactor, IValidationCallback, ResolvedOrder, SignedOrder, OrderInfo, InputToken, OutputToken} from "../../../lib/uniswapx-interfaces/IReactor.sol";
  import {IOrderMixin, IPostInteraction, MakerTraits, TakerTraits, TakerTraitsLib} from "../../../lib/limit-order-protocol/IOrderMixin.sol";
import {EswapUniswapXSettlement} from "../EswapUniswapXSettlement.sol";
import {EswapOneInchFusionSettlement} from "../EswapOneInchFusionSettlement.sol";

/**
 * @dev Mimics UniswapX BaseReactor._resolve + _fill:
 *      resolves the order, calls validate() on the swapper-chosen
 *      additionalValidationContract, pulls input swapper -> filler, then pulls
 *      output filler -> recipient via safeTransferFrom(filler, recipient).
 */
contract MockReactor is IReactor {
    using SafeERC20 for IERC20;

    ResolvedOrder internal resolved;
    bool internal configured;

    function configure(ResolvedOrder calldata order) external {
        resolved = order;
        configured = true;
    }

    function execute(SignedOrder calldata) external payable override {
        require(configured, "not configured");
        IValidationCallback(resolved.info.additionalValidationContract).validate(msg.sender, resolved);

        IERC20(address(resolved.input.token)).safeTransferFrom(resolved.info.swapper, msg.sender, resolved.input.amount);
        OutputToken[] memory outs = resolved.outputs;
        for (uint256 i = 0; i < outs.length; i++) {
            IERC20(outs[i].token).safeTransferFrom(msg.sender, outs[i].recipient, outs[i].amount);
        }
    }

    function executeWithCallback(SignedOrder calldata, bytes calldata) external payable override {
        revert("unused");
    }

    function executeBatch(SignedOrder[] calldata) external payable override {
        revert("unused");
    }

    function executeBatchWithCallback(SignedOrder[] calldata, bytes calldata) external payable override {
        revert("unused");
    }
}

/**
 * @dev Mimics IOrderMixin.fillOrderArgs: parses `args` with the same bit layout
 *      as upstream _parseArgs, pulls makerAsset maker -> taker, pulls takerAsset
 *      taker -> maker, then calls postInteraction on the listener. Mirroring
 *      OrderMixin, the listener defaults to order.maker unless the maker's
 *      extension names one, so a test that omits the settler from the extension
 *      correctly observes NO callback.
 */
contract MockLOP {
    using SafeERC20 for IERC20;

    address public interactionTarget;
    uint256 public postInteractionCalls;
    bool public firePostInteraction;

    function configure(address target, bool fire) external {
        interactionTarget = target;
        firePostInteraction = fire;
    }

    function hashOrder(IOrderMixin.Order calldata order) external pure returns (bytes32) {
        return keccak256(abi.encode(order.salt, order.maker, order.makerAsset, order.takerAsset, order.makingAmount));
    }

    function fillOrderArgs(
        IOrderMixin.Order calldata order,
        bytes32,
        bytes32,
        uint256,
        TakerTraits takerTraits,
        bytes calldata args
    ) external payable returns (uint256 makingAmount, uint256 takingAmount, bytes32 orderHash) {
        makingAmount = order.makingAmount;
        takingAmount = order.takingAmount;
        orderHash = this.hashOrder(order);

        bytes calldata extension = _sliceArgs(args, takerTraits);

        IERC20(order.makerAsset).safeTransferFrom(order.maker, msg.sender, makingAmount);
        IERC20(order.takerAsset).safeTransferFrom(msg.sender, order.maker, takingAmount);

        if (firePostInteraction) {
            postInteractionCalls++;
            address listener = interactionTarget == address(0) ? order.maker : interactionTarget;
            IPostInteraction(listener).postInteraction(
                order, extension, orderHash, msg.sender, makingAmount, takingAmount, 0, ""
            );
        }
    }

    function _sliceArgs(bytes calldata args, TakerTraits takerTraits) private pure returns (bytes calldata extension) {
        if (TakerTraitsLib.argsHasTarget(takerTraits)) {
            args = args[20:];
        }
        uint256 extLen = TakerTraitsLib.argsExtensionLength(takerTraits);
        if (extLen > 0) {
            extension = args[:extLen];
        } else {
            extension = args[:0];
        }
    }
}

contract EswapVenueSettlementTest is Test {
    TestToken internal inputToken;
    TestToken internal outputToken;

    address internal trader = makeAddr("trader");
    address internal operator = makeAddr("operator");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");

    function setUp() public {
        inputToken = new TestToken();
        outputToken = new TestToken();
    }

    function _resolvedOrder(address validationTarget, address filler, address outRecipient) internal view returns (ResolvedOrder memory) {
        return ResolvedOrder({
            info: OrderInfo({
                reactor: IReactor(address(0x1111)),
                swapper: trader,
                nonce: 1,
                deadline: block.timestamp + 1 hours,
                additionalValidationContract: IValidationCallback(validationTarget),
                additionalValidationData: ""
            }),
            input: InputToken({token: IERC20(address(inputToken)), amount: 100e18, maxAmount: 100e18}),
            outputs: new OutputToken[](1),
            sig: "",
            hash: keccak256("order")
        });
    }

    function _uxDeploy(uint256 maxFill) internal returns (EswapUniswapXSettlement s, MockReactor r) {
        r = new MockReactor();
        s = new EswapUniswapXSettlement(IReactor(address(r)), IERC20(address(inputToken)), IERC20(address(outputToken)), maxFill);
        s.setOperator(operator);

        // Reactor pulls the order input from the swapper.
        inputToken.mint(trader, 1000e18);
        vm.prank(trader);
        inputToken.approve(address(r), type(uint256).max);

        // The settler is the filler: it must HOLD the output inventory that the
        // reactor pulls to the recipient (CurrencyLibrary.transferFill).
        outputToken.mint(address(s), 1000e18);
    }

    // ─── UniswapX: validate() security gates ──────────────────────────────

    function test_UX_ValidatePassesForLegitOrder() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        r.configure(o);
        vm.prank(address(r));
        s.validate(address(s), o);
    }

    function test_UX_ValidateRevertsIfCallerNotReactor() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        vm.prank(stranger);
        vm.expectRevert(EswapUniswapXSettlement.NotReactor.selector);
        s.validate(address(s), o);
        r.configure(o);
    }

    function test_UX_ValidateRevertsIfFillerNotSelf() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), stranger, recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        vm.prank(address(r));
        vm.expectRevert(EswapUniswapXSettlement.NotAuthorizedFiller.selector);
        s.validate(stranger, o);
    }

    function test_UX_ValidateRevertsOnWrongInputToken() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        o.input.token = IERC20(address(0xdead));
        s.setPendingRecipient(recipient);
        vm.prank(address(r));
        vm.expectRevert(EswapUniswapXSettlement.UnsupportedInput.selector);
        s.validate(address(s), o);
    }

    function test_UX_ValidateRevertsOnUnauthorizedRecipient() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), stranger);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: stranger});
        s.setPendingRecipient(recipient);
        vm.prank(address(r));
        vm.expectRevert(EswapUniswapXSettlement.UnauthorizedRecipient.selector);
        s.validate(address(s), o);
    }

    function test_UX_ValidateRevertsOnOutputTooLarge() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 500e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        vm.prank(address(r));
        vm.expectRevert(EswapUniswapXSettlement.OutputTooLarge.selector);
        s.validate(address(s), o);
    }

    // ─── UniswapX: fill ───────────────────────────────────────────────────

    function test_UX_FillHappyPath() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        r.configure(o);

        vm.prank(operator);
        s.fill(SignedOrder({order: "", sig: ""}));

        assertEq(outputToken.balanceOf(recipient), 50e18, "recipient not paid");
        assertEq(inputToken.balanceOf(address(s)), 100e18, "input not received");
        assertTrue(s.filledOrders(keccak256(abi.encodePacked(bytes(""), bytes("")))), "not marked filled");
    }

    function test_UX_FillRevertsForNonOperator() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        r.configure(o);
        vm.prank(stranger);
        vm.expectRevert(EswapUniswapXSettlement.NotAuthorizedFiller.selector);
        s.fill(SignedOrder({order: "", sig: ""}));
    }

    function test_UX_FillRevertsOnReplay() public {
        (EswapUniswapXSettlement s, MockReactor r) = _uxDeploy(100e18);
        ResolvedOrder memory o = _resolvedOrder(address(s), address(s), recipient);
        o.outputs[0] = OutputToken({token: address(outputToken), amount: 50e18, recipient: recipient});
        s.setPendingRecipient(recipient);
        r.configure(o);
        vm.startPrank(operator);
        s.fill(SignedOrder({order: "", sig: ""}));
        vm.expectRevert(EswapUniswapXSettlement.OrderAlreadyFilled.selector);
        s.fill(SignedOrder({order: "", sig: ""}));
        vm.stopPrank();
    }

    // ─── 1inch Fusion ─────────────────────────────────────────────────────

    function _oneInchOrder(address maker) internal view returns (IOrderMixin.Order memory) {
        return IOrderMixin.Order({
            salt: 1,
            maker: maker,
            receiver: recipient,
            makerAsset: address(inputToken),
            takerAsset: address(outputToken),
            makingAmount: 100e18,
            takingAmount: 50e18,
            makerTraits: MakerTraits.wrap(0)
        });
    }

    function _fiDeploy() internal returns (EswapOneInchFusionSettlement s, MockLOP lop) {
        lop = new MockLOP();
        s = new EswapOneInchFusionSettlement(IOrderMixin(address(lop)), IERC20(address(inputToken)), IERC20(address(outputToken)), 1000e18);
        s.setOperator(operator);
        inputToken.mint(trader, 1000e18);
        vm.prank(trader);
        inputToken.approve(address(lop), type(uint256).max);
        // The settler is the taker: it must HOLD the takerAsset it owes the maker.
        outputToken.mint(address(s), 1000e18);
        outputToken.mint(address(lop), 1000e18);
    }

    function test_FI_FillHappyPathFiresPostInteraction() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);

        vm.prank(operator);
        s.fill(o, bytes32(0), bytes32(0), 100e18, TakerTraits.wrap(0), "", "", recipient);

        assertEq(inputToken.balanceOf(address(s)), 100e18, "makerAsset not received");
        assertEq(lop.postInteractionCalls(), 1, "postInteraction not called");
        (,, bool fulfilled) = s.pendingFills(lop.hashOrder(o));
        assertTrue(fulfilled, "not fulfilled");
    }

    function test_FI_FillRevertsIfPostInteractionNeverFires() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), false);

        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.PostInteractionNotFired.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, TakerTraits.wrap(0), "", "", recipient);
    }

    function test_FI_PostInteractionRevertsIfCallerNotLOP() public {
        (EswapOneInchFusionSettlement s,) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        vm.prank(stranger);
        vm.expectRevert(EswapOneInchFusionSettlement.NotLOP.selector);
        s.postInteraction(o, "", keccak256("x"), address(s), 1, 1, 0, "");
    }

    function test_FI_PostInteractionRevertsIfFillNotInitiated() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        vm.prank(address(lop));
        vm.expectRevert(EswapOneInchFusionSettlement.OrderNotInitiated.selector);
        s.postInteraction(o, "", keccak256("never"), address(s), 1, 1, 0, "");
    }

    function test_FI_PostInteractionRevertsOnTakerNotSelf() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        vm.prank(address(lop));
        vm.expectRevert(EswapOneInchFusionSettlement.NotTaker.selector);
        s.postInteraction(o, "", keccak256("x"), stranger, 1, 1, 0, "");
    }

    function test_FI_FillRevertsForNonOperator() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        vm.prank(stranger);
        vm.expectRevert(EswapOneInchFusionSettlement.NotOperator.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, TakerTraits.wrap(0), "", "", recipient);
    }

    function test_FI_FillRevertsOnAmountTooLarge() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.AmountTooLarge.selector);
        s.fill(o, bytes32(0), bytes32(0), 2000e18, TakerTraits.wrap(0), "", "", recipient);
    }

    function test_FI_FillRevertsWhenExtensionLengthDisagreesWithTraits() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        // Traits declare a 32-byte extension; supply 4 bytes instead.
        TakerTraits traits = TakerTraits.wrap(uint256(32) << 224);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.ExtensionLengthMismatch.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, traits, hex"11223344", "", recipient);
    }

    function test_FI_FillRevertsOnInteractionLengthMismatch() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        TakerTraits traits = TakerTraits.wrap(uint256(8) << 200);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.InteractionLengthMismatch.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, traits, "", hex"11223344", recipient);
    }

    function test_FI_FillRevertsIfArgsTargetFlagSet() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        TakerTraits traits = TakerTraits.wrap(uint256(1) << 251);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.UnexpectedArgsTarget.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, traits, "", "", recipient);
    }

    function test_FI_FillRevertsWhenReceiverWouldBeMisreported() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.WrongReceiver.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, TakerTraits.wrap(0), "", "", stranger);
    }

    function test_FI_FillRevertsOnWrongAssetPair() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        o.takerAsset = address(inputToken);
        lop.configure(address(s), true);
        vm.prank(operator);
        vm.expectRevert(EswapOneInchFusionSettlement.WrongAsset.selector);
        s.fill(o, bytes32(0), bytes32(0), 100e18, TakerTraits.wrap(0), "", "", recipient);
    }

    function test_FI_ExtensionIsForwardedToPostInteraction() public {
        (EswapOneInchFusionSettlement s, MockLOP lop) = _fiDeploy();
        IOrderMixin.Order memory o = _oneInchOrder(trader);
        lop.configure(address(s), true);
        bytes memory ext = abi.encodePacked(address(s), hex"c0ffee");
        TakerTraits traits = TakerTraits.wrap(uint256(ext.length) << 224);
        vm.prank(operator);
        s.fill(o, bytes32(0), bytes32(0), 100e18, traits, ext, "", recipient);
        (,, bool fulfilled) = s.pendingFills(lop.hashOrder(o));
        assertTrue(fulfilled, "extension-bearing fill not fulfilled");
    }
}
