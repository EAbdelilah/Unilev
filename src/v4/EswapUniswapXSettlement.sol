// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EswapRouter} from "./EswapRouter.sol";
import {PoolKey} from "./types/PoolKey.sol";
import {Currency} from "./types/Currency.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title EswapUniswapXSettlement
 * @notice Permissionless UniswapX-style settlement that opens Eswap leveraged positions.
 *         External fillers call fill() as msg.sender, bond borrow via router escrow,
 *         and are credited as positionSolver.
 */
contract EswapUniswapXSettlement is Ownable {
    using SafeERC20 for IERC20;

    EswapRouter public immutable router;

    error ZeroAddress();
    error InvalidAmount();
    error InvalidLeverage();
    error DeadlineExpired();
    error InsufficientBorrowEscrow(uint256 available, uint256 required);

    event LeveragedFillOpened(
        address indexed solver,
        address indexed trader,
        address indexed marginToken,
        uint256 margin,
        uint8 leverage,
        uint256 borrow
    );

    constructor(EswapRouter _router) Ownable(msg.sender) {
        if (address(_router) == address(0)) revert ZeroAddress();
        router = _router;
    }

    struct FillParams {
        address trader;
        address marginToken;
        uint256 margin;
        uint8 leverage;
        PoolKey key;
        PoolKey standardPoolKey;
        uint256 minAmountOut;
        uint256 deadline;
    }

    function fill(FillParams calldata p) external {
        if (p.trader == address(0)) revert ZeroAddress();
        if (p.margin == 0) revert InvalidAmount();
        if (p.leverage < 2) revert InvalidLeverage();
        if (block.timestamp > p.deadline) revert DeadlineExpired();

        address solver = msg.sender;
        uint256 borrow = p.margin * (uint256(p.leverage) - 1);

        uint256 escrowBal = router.erc20BorrowEscrow(solver, p.marginToken);
        if (escrowBal < borrow) revert InsufficientBorrowEscrow(escrowBal, borrow);

        IERC20(p.marginToken).safeTransferFrom(p.trader, address(this), p.margin);
        IERC20(p.marginToken).forceApprove(address(router), p.margin);

        EswapRouter.SwapParams memory sp = EswapRouter.SwapParams({
            key: p.key,
            standardPoolKey: p.standardPoolKey,
            zeroForOne: _isZeroForOne(p.marginToken, p.key),
            amountSpecified: -int256(p.margin),
            leverage: p.leverage,
            solver: solver,
            hookData: abi.encode(true, p.leverage, p.trader),
            deadline: p.deadline,
            minAmountOut: p.minAmountOut
        });

        router.swapMultiPoolForSolverFunded(sp, p.trader, address(this));
        IERC20(p.marginToken).forceApprove(address(router), 0);

        emit LeveragedFillOpened(solver, p.trader, p.marginToken, p.margin, p.leverage, borrow);
    }

    function _isZeroForOne(address marginToken, PoolKey memory key) internal pure returns (bool) {
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        if (marginToken == c0) return true;
        if (marginToken == c1) return false;
        revert("margin token not in pool");
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }
}
