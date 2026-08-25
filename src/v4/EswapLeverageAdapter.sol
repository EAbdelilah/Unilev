// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "./types/PoolId.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
}

/**
 * @title EswapLeverageAdapter
 * @notice Stateless translation adapter for ODOS / Enso Finance aggregator integration.
 *         Converts aggregator calldata into EswapRouter.swapMultiPoolFor() calls.
 *
 * @dev Integration model (SDIM multi-pool):
 *      1. Aggregator discovers Eswap pools via URC-2/3/4 hooks on the hook contract.
 *      2. Aggregator resolver calls adapter.exactInputSingleWithLeverage().
 *      3. Adapter resolves pool keys from its registry and forwards to the router.
 *      4. Router unlock callback: pulls margin from recipient, borrow from solver,
 *         calls hook.registerMarginOpen(), mints ERC-6909 collateral to hook.
 *
 *      Pre-conditions:
 *        - Recipient must have approved the Eswap Router for margin token
 *          (or use selfPermit via multicall for atomic approve+swap).
 *        - Solver (defaultSolver) must have approved the Eswap Router for borrow token.
 */
contract EswapLeverageAdapter is Ownable {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    EswapRouter public immutable router;

    struct PoolRegistration {
        PoolKey hookPoolKey;
        PoolKey standardPoolKey;
    }

    mapping(address => mapping(address => mapping(uint24 => PoolRegistration))) public poolRegistry;

    address public defaultSolver;

    error PoolNotRegistered(address tokenIn, address tokenOut, uint24 fee);
    error ZeroAddress();
    error SlippageExceeded(uint256 received, uint256 minAmountOut);

    event PoolRegistered(address indexed tokenIn, address indexed tokenOut, uint24 fee);
    event DefaultSolverSet(address indexed solver);
    event LeveragedSwapRouted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint24 fee,
        uint8 leverage,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(EswapRouter _router) Ownable(msg.sender) {
        router = _router;
    }

    // ─── Admin ──────────────────────────────────────────────────────────

    function registerPool(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        PoolKey calldata hookPoolKey,
        PoolKey calldata standardPoolKey
    ) external onlyOwner {
        poolRegistry[tokenIn][tokenOut][fee] =
            PoolRegistration({hookPoolKey: hookPoolKey, standardPoolKey: standardPoolKey});
        emit PoolRegistered(tokenIn, tokenOut, fee);
    }

    function setDefaultSolver(address _solver) external onlyOwner {
        if (_solver == address(0)) revert ZeroAddress();
        defaultSolver = _solver;
        emit DefaultSolverSet(_solver);
    }

    // ─── Aggregator Entry Points ────────────────────────────────────────

    /**
     * @notice Primary entry point for ODOS / Enso aggregators.
     * @param tokenIn   ERC-20 input token (margin currency).
     * @param tokenOut  ERC-20 output token (collateral currency).
     * @param fee       Pool fee tier (3000 = 0.3%, 500 = 0.05%, etc.).
     * @param leverage  Position leverage (2-20). 1 = spot (no margin).
     * @param amountIn  Exact margin amount.
     * @param minAmountOut  Minimum acceptable collateral (slippage guard).
     * @param recipient  Position owner (the trader).
     * @return amountOut  Actual collateral amount received.
     */
    function exactInputSingleWithLeverage(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint8 leverage,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (recipient == address(0)) revert ZeroAddress();

        PoolRegistration storage reg = _getPool(tokenIn, tokenOut, fee);
        bool zeroForOne = _isCurrency0(tokenIn, reg.hookPoolKey);

        address solver = defaultSolver;

        EswapRouter.SwapParams memory params = EswapRouter.SwapParams({
            key: reg.hookPoolKey,
            standardPoolKey: reg.standardPoolKey,
            zeroForOne: zeroForOne,
            amountSpecified: -int256(int256(amountIn)),
            leverage: leverage,
            solver: solver,
            hookData: abi.encode(true, leverage, recipient)
        });

        bytes memory result = router.swapMultiPoolFor(params, recipient);

        // router returns abi.encode(BalanceDelta) where BalanceDelta = int256
        int256 packed = abi.decode(result, (int256));
        // BalanceDelta packs (delta0 << 128 | delta1) — extract via sign-extend
        int128 delta0 = int128(int256(packed >> 128));
        int128 delta1 = int128(uint128(uint256(packed) & 0xffffffffffffffffffffffffffffffff));
        amountOut = uint256(int256(zeroForOne ? delta1 : delta0));

        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        emit LeveragedSwapRouted(tokenIn, tokenOut, fee, leverage, amountIn, amountOut);
    }

    /**
     * @notice Atomic approve+swap for aggregators (selfPermit pattern).
     * @dev Approves the Eswap Router for `msg.sender` so the router can pull
     *      margin during the unlock callback. Use inside multicall for atomicity.
     *      When called via delegatecall (multicall), msg.sender is the original
     *      EOA/contract that initiated the multicall.
     */
    function selfPermit(address token, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
        IERC20Permit(token).permit(msg.sender, address(router), value, deadline, v, r, s);
    }

    /**
     * @notice Batch multiple calls in one transaction (Enso executor pattern).
     */
    function multicall(bytes[] calldata data) external returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);
            if (!success) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            results[i] = result;
        }
    }

    // ─── View Helpers ───────────────────────────────────────────────────

    function getPoolKey(address tokenIn, address tokenOut, uint24 fee)
        external
        view
        returns (PoolKey memory hookPoolKey, PoolKey memory standardPoolKey)
    {
        PoolRegistration storage reg = _getPool(tokenIn, tokenOut, fee);
        return (reg.hookPoolKey, reg.standardPoolKey);
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _getPool(address tokenIn, address tokenOut, uint24 fee)
        internal
        view
        returns (PoolRegistration storage reg)
    {
        reg = poolRegistry[tokenIn][tokenOut][fee];
        if (reg.hookPoolKey.hooks == address(0)) {
            revert PoolNotRegistered(tokenIn, tokenOut, fee);
        }
    }

    function _isCurrency0(address token, PoolKey memory poolKey) internal pure returns (bool) {
        return Currency.unwrap(poolKey.currency0) == token;
    }
}
