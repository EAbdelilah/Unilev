const { ethers } = require('ethers');

const TYPE_HASH = '0xd5a25ba2e97094ad7d83dc28a6572da797d6b3e7fc6663bd93efb789fc17e489';
const KIND_SELL = '0xf3b277728b3fee749481eb3e0b3b48980dbbab78658fc419025cb16eee346775';
const BAL_ERC20 = '0x5a28e9363bb942b639270062aa6bb295f434bcdfc42c97267bf003f272060dc9';
const DOMAIN_TYPE = ethers.id('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');

function orderStructHash(order) {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  return ethers.keccak256(coder.encode(
    ['bytes32','address','address','address','uint256','uint256','uint32','bytes32','uint256','bytes32','bool','bytes32','bytes32'],
    [TYPE_HASH, order.sellToken, order.buyToken, order.receiver, order.sellAmount, order.buyAmount, order.validTo, order.appData, order.feeAmount, KIND_SELL, order.partiallyFillable, BAL_ERC20, BAL_ERC20]
  ));
}

function cowDigest(gpv2DomainSep, order) {
  const struct = orderStructHash(order);
  return ethers.keccak256(ethers.concat(['0x1901', gpv2DomainSep, struct]));
}

module.exports = { orderStructHash, cowDigest, DOMAIN_TYPE, TYPE_HASH };
