const { ethers } = require("ethers")
const { loadAbi } = require("./utils")
const USDC = "0x078D782b760474a361dDA0AF3839290b0EF57AD6"
const hook = "0xeFd436e76685E3b647c4c91Af9B9fE57772090C8"
const trader = "0x518634753C61342298c3E04326056b3Ce596a566"
const key = { currency0: ethers.ZeroAddress, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: hook }
const std = { currency0: ethers.ZeroAddress, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ethers.ZeroAddress }
const hookData = ethers.AbiCoder.defaultAbiCoder().encode(["bool", "uint8", "address"], [true, 3, trader])
const iface = new ethers.Interface(loadAbi("EswapRouter"))
console.log(
    iface.encodeFunctionData("swapMultiPool", [
        [key, std, false, -60000, 3, trader, hookData],
    ])
)