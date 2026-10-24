const { ethers } = require('ethers');

const TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'LendingIntent' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  LendingIntent: [
    { name: 'poolId', type: 'bytes32' },
    { name: 'standardPoolId', type: 'bytes32' },
    { name: 'zeroForOne', type: 'bool' },
    { name: 'amountSpecified', type: 'int256' },
    { name: 'leverage', type: 'uint8' },
    { name: 'solver', type: 'address' },
    { name: 'deadline', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
};

module.exports = { TYPES };
