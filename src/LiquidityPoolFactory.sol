// SPDX-License-Identifier: MIT
pragma solidity =0.8.19;

import "@solmate/tokens/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./LiquidityPool.sol";

// Events
event PositionsAddressSet(address indexed positions);
event LiquidityPoolCreated(address indexed token, address indexed pool);

// Errors
error LiquidityPoolFactory__POOL_ALREADY_EXIST(address pool);
error LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED();

contract LiquidityPoolFactory is Ownable {
    address public positions;

    mapping(address => address) private tokenToLiquidityPools;

    function addPositionsAddress(address _positions) external onlyOwner {
        require(_positions != address(0), "Invalid positions address");
        if (positions != address(0)) {
            revert LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED();
        }
        positions = _positions;
        emit PositionsAddressSet(_positions);
    }

    /**
     * @notice function to create a new liquidity from
     * @param _asset address of the ERC20 token
     * @return address of the new liquidity pool
     */
    function createLiquidityPool(address _asset) external onlyOwner returns (address) {
        require(positions != address(0), "Positions address not set");
        require(_asset != address(0), "Invalid token address");
        address cachedLiquidityPools = tokenToLiquidityPools[_asset];

        if (cachedLiquidityPools != address(0))
            revert LiquidityPoolFactory__POOL_ALREADY_EXIST(cachedLiquidityPools);

        address _liquidityPool = address(new LiquidityPool(ERC20(_asset), positions));

        tokenToLiquidityPools[_asset] = _liquidityPool;
        emit LiquidityPoolCreated(_asset, _liquidityPool);
        return _liquidityPool;
    }

    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return tokenToLiquidityPools[_token];
    }
}
