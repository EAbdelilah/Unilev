const { ethers } = require("ethers");
const routerABI = require("./dashboard/src/abis/EswapRouter.json");
const hookABI = require("./dashboard/src/abis/EswapMarginHook.json");

const ifaceRouter = new ethers.Interface(routerABI.abi);
const ifaceHook = new ethers.Interface(hookABI.abi);

try {
    const fn = ifaceRouter.getFunction("0xb818caa5");
    console.log("Router function:", fn.format());
} catch {
    console.log("Not in router");
}

try {
    const fn = ifaceHook.getFunction("0xb818caa5");
    console.log("Hook function:", fn.format());
} catch {
    console.log("Not in hook");
}

try {
    const fn = ifaceRouter.getFunction("0x4f7884f4");
    console.log("Router function 0x4f7884f4:", fn.format());
} catch {
    console.log("Not in router");
}
