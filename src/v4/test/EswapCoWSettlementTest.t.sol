// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseV4Test, PriceFeedMock, ERC20Mock} from "./BaseV4Test.t.sol";
import {PoolManagerCallbackMock} from "./mocks/PoolManagerMock.sol";
import {EswapMarginHook} from "../EswapMarginHook.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapCoWSettlement, CowOrder} from "../EswapCoWSettlement.sol";
import {CowSigning} from "../cow/CowSigning.sol";
import {PoolKey} from "../types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../types/PoolId.sol";
import {Currency} from "../types/Currency.sol";

/// @dev ERC-1271 verifier that accepts any inner signature (test stand-in for a
///      smart-contract wallet).
contract Eip1271VerifierMock {
    function isValidSignature(bytes32, bytes calldata) external pure returns (bytes4 magicValue) {
        return 0x1626ba7e;
    }
}

/**
 * @title EswapCoWSettlementTest
 * @notice Proves the CoW-compatible settlement: a trader's canonical CoW order
 *         (signed for the real CoW "Gnosis Protocol"/"v2" domain, keyed to a
 *         GPv2Settlement address) can be filled by a solver into a leveraged
 *         Eswap position with the SOLVER funding the margin leg and the
 *         position credited to the recovered order owner.
 */
contract EswapCoWSettlementTest is BaseV4Test {
    using PoolIdLibrary for PoolKey;

    // Byte-exact CoW Protocol order constants (see src/v4/cow/CowOrder.sol).
    bytes32 internal constant COW_TYPE_HASH =
        hex"d5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489";
    bytes32 internal constant KIND_SELL =
        hex"f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";
    bytes32 internal constant KIND_BUY =
        hex"6ed88e868af0a1983e3886d5f3e95a2fafbd6c3450bc229e27342283dc429ccc";
    bytes32 internal constant BALANCE_ERC20 =
        hex"5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9";

    EswapRouter public router;
    EswapCoWSettlement public settlement;
    PoolKey public standardPoolKey;
    address public gpv2Settlement;
    address public solver;

    uint256 internal traderPrivateKey = 0xA11CE;
    address internal trader;

    function setUp() public override {
        manager = new PoolManagerCallbackMock();
        priceFeed = new PriceFeedMock();

        token0 = new ERC20Mock("Token 0", "TK0");
        token1 = new ERC20Mock("Token 1", "TK1");

        address hookAddress = address(uint160((1 << 159) | (1 << 158) | (1 << 153) | (1 << 152) | (1 << 148)));
        deployCodeTo("EswapMarginHook.sol:EswapMarginHook", abi.encode(manager, priceFeed, address(this)), hookAddress);
        hook = EswapMarginHook(payable(hookAddress));

        router = new EswapRouter(manager);

        key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: address(hook)
        });

        standardPoolKey =
            PoolKey({currency0: key.currency0, currency1: key.currency1, fee: 500, tickSpacing: 60, hooks: address(0)});

        hook.setRouterAndMinCollateralUsd(address(router), 0);
        hook.setAuthorizedPool(key.toId(), true);
        hook.setStandardPoolKey(key.toId(), standardPoolKey);

        manager.setSlot0(key.toId(), 1 << 96, 0);
        manager.setSlot0(standardPoolKey.toId(), 1 << 96, 0);

        gpv2Settlement = makeAddr("gpv2Settlement");
        settlement = new EswapCoWSettlement(router, gpv2Settlement);

        solver = makeAddr("solver");
        router.setSolverWhitelist(solver, true);

        trader = vm.addr(traderPrivateKey);

        // The solver funds margin + borrow; the trader never holds/approves tokens.
        token0.mint(solver, 100 ether);
        vm.startPrank(solver);
        token0.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Collateral reserve for the hook's deployCollateral rehypothecation.
        token1.mint(address(hook), 100 ether);
    }

    // ─── Helpers ──────────────────────────────────────────────────────────

    function _order(uint256 margin, uint32 validTo, uint256 minOut)
        internal
        view
        returns (CowOrder.Data memory o)
    {
        o = CowOrder.Data({
            sellToken: address(token0),
            buyToken: address(token1),
            receiver: address(0),
            sellAmount: margin,
            buyAmount: minOut,
            validTo: validTo,
            appData: keccak256("eswap-cow"),
            feeAmount: 0,
            kind: KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: BALANCE_ERC20,
            buyTokenBalance: BALANCE_ERC20
        });
    }

    function _params(uint8 leverage) internal view returns (EswapCoWSettlement.FillParams memory p) {
        p = EswapCoWSettlement.FillParams({
            leverage: leverage,
            solver: solver,
            key: key,
            standardPoolKey: standardPoolKey
        });
    }

    function _signEip712(CowOrder.Data memory order, uint256 pk) internal returns (bytes memory sig) {
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }

    // ─── Reference vectors ────────────────────────────────────────────────

    function test_DomainSeparator_MatchesCoWEip712Domain() public {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gnosis Protocol"),
                keccak256("v2"),
                block.chainid,
                gpv2Settlement
            )
        );
        assertEq(settlement.domainSeparator(), expected, "domain separator mismatch");
        // Two deployments keyed to different settlements must disagree (replay protection).
        EswapCoWSettlement other = new EswapCoWSettlement(router, makeAddr("otherGpv2"));
        assertNotEq(settlement.domainSeparator(), other.domainSeparator());
    }

    function test_OrderHash_MatchesEip712Spec() public view {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 9 ether);
        bytes32 structHash = keccak256(
            abi.encode(
                COW_TYPE_HASH,
                address(token0),
                address(token1),
                address(0),
                uint256(2 ether),
                uint256(9 ether),
                uint32(block.timestamp + 1000),
                order.appData,
                uint256(0),
                KIND_SELL,
                false,
                BALANCE_ERC20,
                BALANCE_ERC20
            )
        );
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", settlement.domainSeparator(), structHash));
        assertEq(settlement.hashOrder(order), expected, "order digest mismatch");
    }

    function test_UidOf_MatchesPackedConcat() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 9 ether);
        bytes32 digest = settlement.hashOrder(order);
        bytes memory expectedUid = abi.encodePacked(digest, trader, order.validTo);
        bytes memory actualUid = settlement.uidOf(order, trader);
        assertEq(actualUid, expectedUid, "uid mismatch");
        assertEq(actualUid.length, 56, "uid length must be 56");
    }

    function test_Verify_RecoversOwner() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 9 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);
        (address owner, bytes32 orderDigest, bytes memory orderUid) =
            settlement.verify(order, CowSigning.Scheme.Eip712, sig);
        assertEq(owner, trader, "recovered owner mismatch");
        assertEq(orderDigest, settlement.hashOrder(order));
        assertEq(orderUid, abi.encodePacked(orderDigest, trader, order.validTo));
    }

    // ─── Fill flows ───────────────────────────────────────────────────────

    function test_Fill_Eip712_OpensPositionUnderOwner_SolverFundsMargin() public {
        uint256 margin = 2 ether;
        uint8 leverage = 5;
        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);

        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(leverage));

        (address posTrader, uint256 collateral, uint256 borrow, uint8 posLev,,,,,) = hook.positions(key.toId(), trader);
        assertEq(posTrader, trader, "position holder must be the recovered order owner");
        assertGt(collateral, 0, "collateral must be minted");
        assertEq(borrow, margin * uint256(leverage - 1), "borrowed leg mismatch");
        assertEq(posLev, leverage, "leverage mismatch");

        // Solver funded margin + borrow (10 ether total); trader untouched.
        assertEq(token0.balanceOf(trader), 0, "trader must not fund the fill");
        assertEq(token0.balanceOf(solver), 100 ether - margin * leverage, "solver funded margin + borrow");

        (address debtSolver, uint256 principal,) = hook.solverDebts(key.toId(), trader, solver);
        assertEq(debtSolver, solver, "solver debt must be registered");
        assertEq(principal, margin * uint256(leverage - 1), "solver principal mismatch");
        assertTrue(settlement.filledOrders(abi.encodePacked(settlement.hashOrder(order), trader, order.validTo)));
    }

    function test_Fill_EmitsOrderFilled() public {
        uint256 margin = 2 ether;
        CowOrder.Data memory order = _order(margin, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);
        bytes memory uid = abi.encodePacked(settlement.hashOrder(order), trader, order.validTo);

        vm.expectEmit(true, true, true, true);
        emit EswapCoWSettlement.OrderFilled(uid, trader, solver, margin, 5);

        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_EthSign() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes32 digest = settlement.hashOrder(order);
        bytes32 ethsignDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, ethsignDigest);
        bytes memory sig = abi.encodePacked(r, s, v);

        settlement.fillOrder(order, CowSigning.Scheme.EthSign, sig, _params(5));

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateral, 0, "eth_sign fill must open the position");
    }

    function test_Fill_Eip1271() public {
        Eip1271VerifierMock verifier = new Eip1271VerifierMock();
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(traderPrivateKey, digest);
        bytes memory sig = abi.encodePacked(address(verifier), r, s, v);

        settlement.fillOrder(order, CowSigning.Scheme.Eip1271, sig, _params(5));

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), address(verifier));
        assertGt(collateral, 0, "eip1271 fill must credit a smart-contract wallet");
    }

    function test_Fill_PreSign() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes memory uid = settlement.uidOf(order, trader);

        vm.prank(trader);
        settlement.setPreSignature(uid, true);

        bytes memory sig = abi.encodePacked(trader);
        settlement.fillOrder(order, CowSigning.Scheme.PreSign, sig, _params(5));

        (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), trader);
        assertGt(collateral, 0, "pre-sign fill must open the position");
    }

    function test_Fill_PreSign_NotSigned_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = abi.encodePacked(trader);
        vm.expectRevert(bytes("Cow: order not presigned"));
        settlement.fillOrder(order, CowSigning.Scheme.PreSign, sig, _params(5));
    }

    function test_Fill_Batch_ThreeOrders() public {
        uint256[] memory keys = new uint256[](3);
        keys[0] = 0xA11CE;
        keys[1] = 0xB22DF;
        keys[2] = 0xC33EA;

        CowOrder.Data[] memory orders = new CowOrder.Data[](3);
        CowSigning.Scheme[] memory schemes = new CowSigning.Scheme[](3);
        bytes[] memory sigs = new bytes[](3);
        EswapCoWSettlement.FillParams[] memory params = new EswapCoWSettlement.FillParams[](3);

        for (uint256 i = 0; i < 3; i++) {
            CowOrder.Data memory order = _order(1 ether + i, uint32(block.timestamp + 1000), 1 ether);
            order.appData = keccak256(abi.encode("batch", i));
            orders[i] = order;
            schemes[i] = CowSigning.Scheme.Eip712;
            sigs[i] = _signEip712(order, keys[i]);
            params[i] = _params(2);
        }

        uint256 count = settlement.fillOrders(orders, schemes, sigs, params);
        assertEq(count, 3, "all orders must fill");

        for (uint256 i = 0; i < 3; i++) {
            (, uint256 collateral,,,,,,,) = hook.positions(key.toId(), vm.addr(keys[i]));
            assertGt(collateral, 0, "batch fill must open each position");
        }
    }

    // ─── Validation / protection ──────────────────────────────────────────

    function test_Fill_Replay_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));

        bytes memory uid = abi.encodePacked(settlement.hashOrder(order), trader, order.validTo);
        vm.expectRevert(abi.encodeWithSelector(EswapCoWSettlement.OrderAlreadyFilled.selector, uid));
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_Expired_Reverts() public {
        uint32 validTo = uint32(block.timestamp - 1);
        CowOrder.Data memory order = _order(2 ether, validTo, 1 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(abi.encodeWithSelector(EswapCoWSettlement.OrderExpired.selector, validTo, block.timestamp));
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_WrongKind_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.kind = KIND_BUY;
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(EswapCoWSettlement.InvalidOrderKind.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_PartiallyFillable_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.partiallyFillable = true;
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(EswapCoWSettlement.PartiallyFillableNotSupported.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_FeeNotSupported_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.feeAmount = 1;
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(abi.encodeWithSelector(EswapCoWSettlement.FeeNotSupported.selector, uint256(1)));
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_BalanceNotErc20_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.sellTokenBalance = keccak256("external");
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(EswapCoWSettlement.UnsupportedTokenBalance.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_TokenMismatch_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.sellToken = address(this);
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(EswapCoWSettlement.TokenMismatch.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_ReceiverMismatch_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        order.receiver = makeAddr("stranger");
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(
            abi.encodeWithSelector(EswapCoWSettlement.ReceiverMismatch.selector, order.receiver, trader)
        );
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_InvalidSignature_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = new bytes(65); // all-zero r,s,v

        vm.expectRevert(bytes("Cow: invalid ecdsa signature"));
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }

    function test_Fill_ZeroSolver_Reverts() public {
        CowOrder.Data memory order = _order(2 ether, uint32(block.timestamp + 1000), 1 ether);
        bytes memory sig = _signEip712(order, traderPrivateKey);
        EswapCoWSettlement.FillParams memory params = _params(5);
        params.solver = address(0);

        vm.expectRevert(EswapCoWSettlement.ZeroSolver.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, params);
    }

    function test_Fill_ZeroMargin_Reverts() public {
        CowOrder.Data memory order = _order(0, uint32(block.timestamp + 1000), 0);
        bytes memory sig = _signEip712(order, traderPrivateKey);

        vm.expectRevert(EswapCoWSettlement.InvalidAmount.selector);
        settlement.fillOrder(order, CowSigning.Scheme.Eip712, sig, _params(5));
    }
}