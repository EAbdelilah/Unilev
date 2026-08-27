// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LiquidityPool} from "./LiquidityPool.sol";

// Errors
error LiquidityPoolFactory__POOL_ALREADY_EXIST(address pool);
error LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED();

contract LiquidityPoolFactory is Ownable {
    mapping(address => address) private tokenToLiquidityPools;

    constructor() Ownable(msg.sender) {}

    /**
     * @notice function to create a new liquidity from
     * @param _asset address of the ERC20 token
     * @return address of the new liquidity pool
     */
    function createLiquidityPool(address _asset, address positions) external onlyOwner returns (address) {
        address cachedLiquidityPools = tokenToLiquidityPools[_asset];

        if (cachedLiquidityPools != address(0)) {
            revert LiquidityPoolFactory__POOL_ALREADY_EXIST(cachedLiquidityPools);
        }

        IERC20Metadata token = IERC20Metadata(_asset);
        string memory name = string.concat("UniswapMaxLP-", token.name());
        string memory symbol = string.concat("um", token.symbol());

        address _liquidityPool = address(new LiquidityPool(token, positions, name, symbol));

        tokenToLiquidityPools[_asset] = _liquidityPool;
        return _liquidityPool;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return tokenToLiquidityPools[_token];
    }
}
