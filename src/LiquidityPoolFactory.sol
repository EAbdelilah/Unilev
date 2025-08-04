// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@solmate/tokens/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./LiquidityPool.sol";

// Errors
error LiquidityPoolFactory__POOL_ALREADY_EXIST(address pool);
error LiquidityPoolFactory__POSITIONS_ALREADY_DEFINED(); // Kept for bytecode compatibility
error LiquidityPoolFactory__INVALID_ADDRESS();
error LiquidityPoolFactory__POSITIONS_NOT_SET();
// START SECURITY ADDITION - Timelock Errors
error LiquidityPoolFactory__TIMELOCK_NOT_EXPIRED();
// END SECURITY ADDITION

/**
 * @title LiquidityPoolFactory
 * @author [Your Name/Organization]
 * @notice This factory is responsible for creating and managing LiquidityPool contracts.
 * @dev It includes a timelock mechanism for updating the critical Positions contract address
 *      to enhance security. The initial address can be set immediately for deployment purposes.
 *      Ownership should be transferred to a multi-sig or DAO to mitigate centralization risk.
 */
contract LiquidityPoolFactory is Ownable {
    // --- State Variables ---

    address public positions;

    mapping(address => address) private tokenToLiquidityPools;

    // START SECURITY ADDITION - Timelock variables
    uint256 public constant TIMELOCK_DELAY = 2 days; // 48-hour delay for critical changes

    address private s_pendingPositions;
    uint256 private s_pendingPositionsTimestamp;
    // END SECURITY ADDITION

    // START SECURITY ADDITION - Timelock events
    event PositionsUpdateProposed(address indexed newPositionsAddress, uint256 executionTimestamp);
    event PositionsUpdateCommitted(address indexed newPositionsAddress);
    // END SECURITY ADDITION


    /**
     * @notice Sets or updates the address of the Positions contract.
     * @dev For initial deployment, this function sets the address immediately if it hasn't been set before.
     *      For all subsequent updates, it enforces a mandatory two-step timelock process:
     *      1. Propose: Call with the new address to start the timelock.
     *      2. Commit: Call again with the same address after TIMELOCK_DELAY to apply the change.
     * @param _positions The address of the new Positions contract to set, propose, or commit.
     */
    function addPositionsAddress(address _positions) external onlyOwner {
        if (_positions == address(0)) {
            revert LiquidityPoolFactory__INVALID_ADDRESS();
        }

        // --- INITIALIZATION LOGIC ---
        // Allow setting the address immediately ONLY if it has never been set.
        // This is crucial for deployment scripts to work without a delay.
        if (positions == address(0)) {
            positions = _positions;
            emit PositionsUpdateCommitted(_positions);
            return; // Exit early to bypass timelock logic on initialization
        }

        // --- TIMELOCK LOGIC FOR UPDATES ---

        // COMMIT LOGIC: If the provided address matches the pending one, attempt to commit.
        if (_positions == s_pendingPositions) {
            if (block.timestamp < s_pendingPositionsTimestamp) {
                revert LiquidityPoolFactory__TIMELOCK_NOT_EXPIRED();
            }
            positions = _positions;
            s_pendingPositions = address(0);
            s_pendingPositionsTimestamp = 0;
            emit PositionsUpdateCommitted(_positions);
        }
        // PROPOSE LOGIC: If the address is new, set it as a pending proposal.
        // This overwrites any previous proposal and resets the timer.
        else {
            s_pendingPositions = _positions;
            uint256 executionTimestamp = block.timestamp + TIMELOCK_DELAY;
            s_pendingPositionsTimestamp = executionTimestamp;
            emit PositionsUpdateProposed(_positions, executionTimestamp);
        }
    }

    /**
     * @notice Creates a new liquidity pool for a given ERC20 asset.
     * @dev This function can only be called by the owner. It ensures that a Positions
     *      contract has been set and that a pool for the given asset does not already exist.
     * @param _asset The address of the ERC20 token for which to create a liquidity pool.
     * @return address The address of the newly created liquidity pool.
     */
    function createLiquidityPool(address _asset) external onlyOwner returns (address) {
        if (positions == address(0)) {
            revert LiquidityPoolFactory__POSITIONS_NOT_SET();
        }
        if (_asset == address(0)) {
            revert LiquidityPoolFactory__INVALID_ADDRESS();
        }

        address cachedLiquidityPools = tokenToLiquidityPools[_asset];

        if (cachedLiquidityPools != address(0)) {
            revert LiquidityPoolFactory__POOL_ALREADY_EXIST(cachedLiquidityPools);
        }

        address _liquidityPool = address(new LiquidityPool(ERC20(_asset), positions));

        tokenToLiquidityPools[_asset] = _liquidityPool;
        return _liquidityPool;
    }

    /**
     * @notice Retrieves the address of the liquidity pool for a given token.
     * @param _token The address of the token.
     * @return address The address of the corresponding liquidity pool, or the zero address if none exists.
     */
    function getTokenToLiquidityPools(address _token) external view returns (address) {
        return tokenToLiquidityPools[_token];
    }

    /*
    ================================================================================
    =                           SECURITY RECOMMENDATION                            =
    ================================================================================
    = To fully mitigate the "Single Point of Failure" risk inherent in the Ownable =
    = pattern, it is critical to transfer the ownership of this contract to a      =
    = multi-signature wallet (e.g., Gnosis Safe) or a decentralized governance     =
    = system (DAO). This ensures that no single private key compromise can lead to =
    = malicious administrative actions.                                            =
    ================================================================================
    */
}