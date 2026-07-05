// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC6909 {
    function balanceOf(address owner, uint256 id) external view returns (uint256);
    function allowance(address owner, address spender, uint256 id) external view returns (uint256);
    function isOperator(address owner, address operator) external view returns (bool);
    function transfer(address receiver, uint256 id, uint256 amount) external returns (bool);
    function transferFrom(address sender, address receiver, uint256 id, uint256 amount) external returns (bool);
    function approve(address spender, uint256 id, uint256 amount) external returns (bool);
    function setOperator(address operator, bool approved) external returns (bool);
}
