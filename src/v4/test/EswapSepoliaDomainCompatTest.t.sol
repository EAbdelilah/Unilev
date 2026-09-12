// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {EswapRouter} from "../EswapRouter.sol";
import {EswapCoWSettlement, CowOrder} from "../EswapCoWSettlement.sol";
import {CowSigning} from "../cow/CowSigning.sol";

/// @notice BYTE-COMPATIBILITY PROOF against the REAL CoW Protocol deployment on
///         Ethereum Sepolia (chainId 11155111).
///
///   Covers the "ready to use real solvers" claim at the bytes level: the same
///   EIP-712 domain and order digest that real CoW order-book signatures are
///   produced over on Sepolia (canonical GPv2Settlement 0x9008…ab41, name
///   "Gnosis Protocol" v2, chainId 11155111) are reproduced EXACTLY by our
///   clean-room CowSigning/CowOrder implementation when deployed in the fork.
///
///   The two digest vectors below were computed INDEPENDENTLY (ethers.js
///   TypedDataEncoder, javascript/v4/realApis/cowOrderBook.js) and are pinned
///   here so the on-chain result must equal the canonical off-chain values.
///
/// ```
///   expectedSepoliaDomain = 0xdaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230b
///   expectedSepoliaDigest = 0x5a5d9a273a567a00d2163070db4c06d9d82db60d370b54fc758ca9c51fd5c9a4
///   expectedUnichainSepoliaDomain (1301, live stack) =
///                              0xd815a6a99cfa28a883bf8ae6aaf9be04a42464a978185a0b68ebf99e9b932384
/// ```
contract EswapSepoliaDomainCompatTest is Test {
    // Byte-exact CoW Protocol constants (see src/v4/cow/CowOrder.sol).
    bytes32 internal constant COW_TYPE_HASH = hex"d5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489";
    bytes32 internal constant KIND_SELL = hex"f3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775";
    bytes32 internal constant BALANCE_ERC20 = hex"5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9";

    // Real Ethereum Sepolia (11155111) addresses (verified live on-chain).
    address internal constant SEPOLIA_GPV2 = 0x9008D19f58AAbD9eD0D60971565AA8510560ab41;
    address internal constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address internal constant SEPOLIA_WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // Canonical domain separators for the SAME GPv2 keyed to each CoW-enabled
    // chain (computed independently below the Solidity ABI encoder, ethers.js).
    bytes32 internal constant EXP_SEP_ETH_SEPOLIA = 0xdaee378bd0eb30ddf479272accf91761e697bc00e067a268f95f1d2732ed230b;
    bytes32 internal constant EXP_SEP_UNICHAIN_SEPOLIA =
        0xd815a6a99cfa28a883bf8ae6aaf9be04a42464a978185a0b68ebf99e9b932384;

    // Fixed order vector pinned from javascript/v4/realApis/cowOrderBook.js:
    //   sell 5e6 USDC (0x1c7D…), buy 2e15 WETH (0x7b79…), receiver=0,
    //   validTo=2100000000, appData=keccak256("eswap-real-cow-sepolia"),
    //   kind="sell", balances erc20/erc20, fee=0, not partially fillable.
    bytes32 internal constant FIXED_APP_DATA = 0x787fda9391fd4d42811a531f19d3a003fce2f0b70a9c5cfd6775691de058c248;
    uint32 internal constant FIXED_VALID_TO = 2_100_000_000;
    uint256 internal constant FIXED_MARGIN = 5_000_000;
    uint256 internal constant FIXED_MIN_OUT = 2_000_000_000_000_000;
    bytes32 internal constant EXP_DIGEST = 0x5a5d9a273a567a00d2163070db4c06d9d82db60d370b54fc758ca9c51fd5c9a4;

    // Stand-in router address: the domain/digest checks never invoke it.
    address internal constant STUB_ROUTER = 0x000000000000000000000000000000000000dEaD;

    EswapCoWSettlement settlement;
    uint256 internal traderPk = 0xA11CE;

    bool rpcAvailable;

    function setUp() public {
        string memory rpcUrl = vm.envOr("ETH_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        require(block.chainid == 11155111, "expected an Ethereum Sepolia fork");
        settlement = new EswapCoWSettlement(EswapRouter(payable(STUB_ROUTER)), SEPOLIA_GPV2);
        rpcAvailable = true;
    }

    function _order() internal pure returns (CowOrder.Data memory o) {
        o = CowOrder.Data({
            sellToken: SEPOLIA_USDC,
            buyToken: SEPOLIA_WETH,
            receiver: address(0),
            sellAmount: FIXED_MARGIN,
            buyAmount: FIXED_MIN_OUT,
            validTo: FIXED_VALID_TO,
            appData: FIXED_APP_DATA,
            feeAmount: 0,
            kind: KIND_SELL,
            partiallyFillable: false,
            sellTokenBalance: BALANCE_ERC20,
            buyTokenBalance: BALANCE_ERC20
        });
    }

    // ─── Environment sanity ───────────────────────────────────────────────

    function test_RealSepolia_CanonicalCoWDeployment_Present() public {
        if (!rpcAvailable) return;
        assertGt(SEPOLIA_GPV2.code.length, 0, "canonical CoW GPv2Settlement must be deployed on Sepolia");
        assertGt(SEPOLIA_USDC.code.length, 0, "real Sepolia USDC must have bytecode");
        assertGt(SEPOLIA_WETH.code.length, 0, "real Sepolia WETH must have bytecode");
        console2.log("GPv2Settlement code bytes:", SEPOLIA_GPV2.code.length);
    }

    // ─── Domain separator ─────────────────────────────────────────────────

    function test_RealSepolia_DomainSeparator_MatchesCanonicalVector() public view {
        if (!rpcAvailable) return;
        assertEq(settlement.domainSeparator(), EXP_SEP_ETH_SEPOLIA, "canonical chain-11155111 domain");
        // Independent re-derivation with the spec formula for cross-checking.
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gnosis Protocol"),
                keccak256("v2"),
                block.chainid,
                SEPOLIA_GPV2
            )
        );
        assertEq(settlement.domainSeparator(), expected, "domain separator formula mismatch");
        assertEq(expected, EXP_SEP_ETH_SEPOLIA, "spec formula must equal the pinned canonical value");
        console2.log("Real Sepolia domain separator:", vm.toString(settlement.domainSeparator()));
    }

    function test_UnichainSepolia_Domain_FormulaMatchesLiveStackAnchor() public pure {
        bytes32 unichainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("Gnosis Protocol"),
                keccak256("v2"),
                uint256(1301),
                SEPOLIA_GPV2
            )
        );
        // The LIVE REDEPLOY-4 settlement on Unichain Sepolia binds chainId 1301
        // to the same canonical GPv2 contract, so its domain is exactly this.
        assertEq(unichainSep, EXP_SEP_UNICHAIN_SEPOLIA, "chain-1301 domain mismatch");
        console2.log("Unichain Sepolia (live stack) domain:", vm.toString(unichainSep));
    }

    // ─── Order digest (the bytes real CoW signatures are made over) ───────

    function test_RealSepolia_OrderDigest_MatchesCanonicalVector() public {
        if (!rpcAvailable) return;
        CowOrder.Data memory order = _order();
        bytes32 digest = settlement.hashOrder(order);
        assertEq(digest, EXP_DIGEST, "order digest must equal the canonical off-chain vector");
        console2.log("Real Sepolia order digest:", vm.toString(digest));
    }

    function test_RealSepolia_Uid_MatchesCanonicalShape() public {
        if (!rpcAvailable) return;
        CowOrder.Data memory order = _order();
        bytes memory uid = settlement.uidOf(order, vm.addr(traderPk));
        assertEq(uid.length, 56, "CoW UID must be digest(32)|owner(20)|validTo(4)");
        bytes32 digest = settlement.hashOrder(order);
        assertEq(abi.encodePacked(digest, vm.addr(traderPk), order.validTo), uid, "uid packing mismatch");
    }

    // ─── Real-domain signature semantics ──────────────────────────────────

    function test_RealSepolia_Eip712Sign_RecoversOnRealDomain() public {
        if (!rpcAvailable) return;
        CowOrder.Data memory order = _order();
        bytes memory sig = _signEip712(order, traderPk);
        (address owner, bytes32 digest, bytes memory uid) = settlement.verify(order, CowSigning.Scheme.Eip712, sig);
        assertEq(owner, vm.addr(traderPk), "EIP-712 recovery on the real Sepolia domain must yield the signer");
        assertEq(digest, settlement.hashOrder(order));
        assertEq(uid.length, 56, "uid length");
        console2.log("recovered owner (real Sepolia CoW domain):", owner);
    }

    function _signEip712(CowOrder.Data memory order, uint256 pk) internal returns (bytes memory sig) {
        bytes32 digest = settlement.hashOrder(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        sig = abi.encodePacked(r, s, v);
    }
}
