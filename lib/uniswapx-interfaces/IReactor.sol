// SPDX-License-Identifier: GPL-2.0-or-later
// Vendored from https://github.com/Uniswap/uniswapx (src/interfaces/IReactor.sol, src/base/ReactorStructs.sol)
// Unmodified declarations. ERC20 type reference changed from solmate to
// OpenZeppelin IERC20; both encode as `address` so the ABI is identical.
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

struct OrderInfo {
    IReactor reactor;
    address swapper;
    uint256 nonce;
    uint256 deadline;
    IValidationCallback additionalValidationContract;
    bytes additionalValidationData;
}

struct InputToken {
    IERC20 token;
    uint256 amount;
    uint256 maxAmount;
}

struct OutputToken {
    address token;
    uint256 amount;
    address recipient;
}

struct ResolvedOrder {
    OrderInfo info;
    InputToken input;
    OutputToken[] outputs;
    bytes sig;
    bytes32 hash;
}

struct SignedOrder {
    bytes order;
    bytes sig;
}

interface IReactor {
    function execute(SignedOrder calldata order) external payable;

    function executeWithCallback(SignedOrder calldata order, bytes calldata callbackData) external payable;

    function executeBatch(SignedOrder[] calldata orders) external payable;

    function executeBatchWithCallback(
        SignedOrder[] calldata orders,
        bytes calldata callbackData
    ) external payable;
}

interface IValidationCallback {
    function validate(address filler, ResolvedOrder calldata resolvedOrder) external view;
}
