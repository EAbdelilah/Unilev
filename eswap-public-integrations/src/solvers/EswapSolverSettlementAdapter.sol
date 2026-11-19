// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {EswapRouter} from "../../../src/v4/EswapRouter.sol";
import {PoolKey} from "../../../src/v4/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "../../../src/v4/types/PoolId.sol";
import {Currency} from "../../../src/v4/types/Currency.sol";
import {CowOrder} from "../../../src/v4/cow/CowOrder.sol";
import {CowSigning} from "../../../src/v4/cow/CowSigning.sol";
import {EswapCoWSettlement} from "../../../src/v4/EswapCoWSettlement.sol";

interface IEswapRouterSolver {
    function swapWithIntent(
        EswapRouter.SwapParams calldata params,
        address trader,
        EswapRouter.LendingIntent calldata intent,
        bytes calldata signature
    ) external payable returns (bytes memory);

    function depositBorrowEscrow(address token, uint256 amount) external;

    function erc20BorrowEscrow(address solver, address token) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function hashIntent(EswapRouter.LendingIntent calldata intent) external pure returns (bytes32);
}

interface IEswapSettlementRail {
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external payable;
}

interface IEswapCoWRail {
    function fillOrder(
        CowOrder.Data calldata order,
        CowSigning.Scheme scheme,
        bytes calldata signature,
        EswapCoWSettlement.FillParams calldata params
    ) external returns (address owner);
}

interface IEswapHookState {
    function positionSolver(bytes32 poolId, address trader) external view returns (address);
}

/**
 * @title EswapSolverSettlementAdapter
 * @notice Permissionless solver capital + settlement rail facade.
 *
 * @dev A searcher posts the 4x borrow leg into `EswapRouter.erc20BorrowEscrow`
 *      under this adapter, fills a trader-signed LendingIntent (or a CoW /
 *      ERC-7683 order), and is recorded as the economic yield claimant. When
 *      the position closes, the hook pays rehypothecation yield to the adapter
 *      as `positionSolver`; the solver then calls `claimYield` to take 100% of
 *      it. Principal repayment is handled by the underlying hook/router.
 */
contract EswapSolverSettlementAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    address public constant ROUTER = 0x5b226aE5158de86f1E616875dBab886870B9aAd9;
    address public constant HOOK = 0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8;
    address public constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address public constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address public constant COW_SETTLEMENT = 0x7341859C0D7e039118b3f85F341583EBCDB8c960;
    address public constant ERC7683_SETTLEMENT = 0x6F347acB3bD901731e192d482b7a40c50f30FCa1;

    error UnauthorizedSolver();
    error InsufficientBond(uint256 available, uint256 required);
    error InvalidIntentParams();
    error PositionStillOpen();
    error NothingToClaim();

    event SolverBonded(address indexed solver, address indexed token, uint256 amount);
    event IntentFilled(address indexed solver, address indexed trader, bytes32 indexed poolId, uint256 bondUsed);
    event Erc7683Filled(bytes32 indexed orderId, address indexed filler);
    event CowFilled(address indexed owner, address indexed solver, uint256 margin);
    event YieldClaimed(address indexed solver, address indexed token, bytes32 indexed poolId, uint256 amount);

    IEswapRouterSolver public immutable router;
    IEswapSettlementRail public immutable erc7683;
    IEswapCoWRail public immutable cow;
    IEswapHookState public immutable hook;

    mapping(address solver => mapping(address token => uint256 credit)) public bondCredit;
    mapping(bytes32 claimKey => address solver) public yieldClaimant;

    constructor() {
        router = IEswapRouterSolver(ROUTER);
        erc7683 = IEswapSettlementRail(ERC7683_SETTLEMENT);
        cow = IEswapCoWRail(COW_SETTLEMENT);
        hook = IEswapHookState(HOOK);
    }

    receive() external payable {}

    /// @notice Post (or top up) a solver bond in the router's ERC-20 escrow.
    function bondBorrow(address token, uint256 amount) external nonReentrant returns (uint256 credit) {
        require(amount > 0, "zero bond");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(token).forceApprove(ROUTER, amount);
        router.depositBorrowEscrow(token, amount);
        IERC20(token).forceApprove(ROUTER, 0);
        bondCredit[msg.sender][token] += amount;
        credit = bondCredit[msg.sender][token];
        emit SolverBonded(msg.sender, token, amount);
    }

    /// @notice EIP-712 digest helper for off-chain intent signing.
    function intentDigest(EswapRouter.LendingIntent calldata intent)
        external
        view
        returns (bytes32 digest)
    {
        digest = keccak256(
            abi.encodePacked("\x19\x01", router.DOMAIN_SEPARATOR(), router.hashIntent(intent))
        );
    }

    /**
     * @notice Fill a trader-signed LendingIntent using the caller's bonded borrow.
     * @dev The intent and params must both name this adapter as solver, so the
     *      hook records it as `positionSolver` and routes LP yield here.
     */
    function fillWithIntent(
        EswapRouter.SwapParams calldata params,
        address trader,
        EswapRouter.LendingIntent calldata intent,
        bytes calldata signature
    ) external nonReentrant returns (uint256 positionEpoch) {
        if (params.solver != address(this) || intent.solver != address(this)) revert InvalidIntentParams();
        if (params.leverage != 5 || intent.leverage != 5) revert InvalidIntentParams();
        if (params.key.hooks != HOOK || params.standardPoolKey.hooks != address(0)) revert InvalidIntentParams();
        if (trader == address(0)) revert UnauthorizedSolver();

        address inputToken = Currency.unwrap(params.zeroForOne ? params.key.currency0 : params.key.currency1);
        uint256 margin = uint256(-params.amountSpecified);
        uint256 borrow = margin * 4;
        if (bondCredit[msg.sender][inputToken] < borrow) {
            revert InsufficientBond(bondCredit[msg.sender][inputToken], borrow);
        }
        if (router.erc20BorrowEscrow(address(this), inputToken) < borrow) {
            revert InsufficientBond(router.erc20BorrowEscrow(address(this), inputToken), borrow);
        }

        bondCredit[msg.sender][inputToken] -= borrow;
        router.swapWithIntent(params, trader, intent, signature);

        bytes32 poolId = PoolId.unwrap(params.key.toId());
        yieldClaimant[keccak256(abi.encode(poolId, trader))] = msg.sender;
        emit IntentFilled(msg.sender, trader, poolId, borrow);
        positionEpoch = 1;
    }

    /// @notice Fill a canonical ERC-7683 order through the deployed settler.
    /// @dev The adapter must hold the full notional; approvals are scoped to the
    ///      fill and reset to zero before return.
    function fillErc7683(bytes32 orderId, bytes calldata originData, bytes calldata fillerData)
        external
        nonReentrant
    {
        (PoolKey memory key,, bool zeroForOne, int256 amountSpecified, uint8 leverage,,,) = abi.decode(
            originData, (PoolKey, PoolKey, bool, int256, uint8, address, bytes, uint256)
        );
        if (leverage != 5 || amountSpecified >= 0) revert InvalidIntentParams();
        address tokenIn = Currency.unwrap(zeroForOne ? key.currency0 : key.currency1);
        uint256 notional = uint256(-amountSpecified) * 5;

        IERC20(tokenIn).forceApprove(ERC7683_SETTLEMENT, notional);
        erc7683.fill(orderId, originData, fillerData);
        IERC20(tokenIn).forceApprove(ERC7683_SETTLEMENT, 0);
        emit Erc7683Filled(orderId, msg.sender);
    }

    /// @notice Fill a signed CoW order through the deployed CoW settlement.
    function fillCoW(
        CowOrder.Data calldata order,
        CowSigning.Scheme scheme,
        bytes calldata signature,
        EswapCoWSettlement.FillParams calldata params
    ) external nonReentrant returns (address owner) {
        if (params.solver != address(this) || params.leverage != 5) revert InvalidIntentParams();
        IERC20(order.sellToken).forceApprove(COW_SETTLEMENT, order.sellAmount);
        owner = cow.fillOrder(order, scheme, signature, params);
        IERC20(order.sellToken).forceApprove(COW_SETTLEMENT, 0);
        emit CowFilled(owner, msg.sender, order.sellAmount);
    }

    /**
     * @notice Claim 100% of the rehypothecation LP yield after a position closes.
     * @dev Principal is returned by the hook to `positionSolver` (this adapter)
     *      together with yield. This facade forwards the whole free balance of
     *      `token` to the bonded solver that funded the fill.
     */
    function claimYield(address token, bytes32 poolId, address trader)
        external
        nonReentrant
        returns (uint256 amount)
    {
        bytes32 key = keccak256(abi.encode(poolId, trader));
        if (yieldClaimant[key] != msg.sender) revert UnauthorizedSolver();
        if (hook.positionSolver(poolId, trader) != address(0)) revert PositionStillOpen();

        amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToClaim();
        delete yieldClaimant[key];
        IERC20(token).safeTransfer(msg.sender, amount);
        emit YieldClaimed(msg.sender, token, poolId, amount);
    }
}
