// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title EswapTimelock
 * @notice Time-locked governance wrapper for EswapMarginHook owner operations.
 *         Becomes the `owner` of the hook so all critical parameter changes
 *         (pool authorization, fee config, insurance withdrawals, etc.)
 *         must pass through a mandatory delay period before execution.
 *
 * @dev Emergency functions (setEmergencyPause) bypass the timelock for safety.
 *      All other owner-only calls on the hook are gated by the queue+execute pattern.
 */
contract EswapTimelock {
    error NotAdmin();
    error NotReady();
    error TransactionTooFresh();
    error TransactionAlreadyQueued();
    error TransactionNotQueued();
    error ExecutionFailed();

    event TransactionQueued(bytes32 indexed txHash, address indexed target, uint256 eta);
    event TransactionExecuted(bytes32 indexed txHash, address indexed target);
    event TransactionCancelled(bytes32 indexed txHash, address indexed target);

    address public immutable admin;
    address public immutable hook;
    uint256 public immutable delay; // seconds

    mapping(bytes32 => bool) public queued;

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address _hook, address _admin, uint256 _delay) {
        if (_hook == address(0) || _admin == address(0)) revert ExecutionFailed();
        if (_delay < 1 hours) revert ExecutionFailed(); // minimum 1 hour
        hook = _hook;
        admin = _admin;
        delay = _delay;
    }

    // ─── Emergency (No Delay) ───────────────────────────────────────────

    /// @notice Toggle emergency pause on the hook immediately (no delay).
    function emergencyPause(bool paused) external onlyAdmin {
        bytes memory callData = abi.encodeWithSignature("setEmergencyPause(bool)", paused);
        (bool success,) = hook.call(callData);
        if (!success) revert ExecutionFailed();
    }

    // ─── Queue / Execute ────────────────────────────────────────────────

    /// @notice Queue a transaction for future execution.
    /// @dev M-1 FIX: eta must be >= block.timestamp + delay.
    ///      M-9 FIX: target must be the hook address.
    function queue(address target, bytes calldata data, uint256 eta) external onlyAdmin {
        // M-9: Only allow targeting the hook
        if (target != hook) revert ExecutionFailed();

        bytes32 txHash = keccak256(abi.encode(target, data, eta));
        if (queued[txHash]) revert TransactionAlreadyQueued();

        // M-1: Enforce minimum delay
        if (eta < block.timestamp + delay) revert TransactionTooFresh();

        queued[txHash] = true;
        emit TransactionQueued(txHash, target, eta);
    }

    /// @notice Execute a queued transaction after its eta has passed.
    function execute(address target, bytes calldata data, uint256 eta) external {
        bytes32 txHash = keccak256(abi.encode(target, data, eta));
        if (!queued[txHash]) revert TransactionNotQueued();
        if (block.timestamp < eta) revert NotReady();

        queued[txHash] = false;

        (bool success,) = target.call(data);
        if (!success) revert ExecutionFailed();

        emit TransactionExecuted(txHash, target);
    }

    /// @notice Cancel a queued transaction (admin only).
    function cancel(address target, bytes calldata data, uint256 eta) external onlyAdmin {
        bytes32 txHash = keccak256(abi.encode(target, data, eta));
        if (!queued[txHash]) revert TransactionNotQueued();

        queued[txHash] = false;
        emit TransactionCancelled(txHash, target);
    }

    // ─── Views ──────────────────────────────────────────────────────────

    function getTxHash(address target, bytes calldata data, uint256 eta) external pure returns (bytes32) {
        return keccak256(abi.encode(target, data, eta));
    }

    function isQueued(bytes32 txHash) external view returns (bool) {
        return queued[txHash];
    }
}
