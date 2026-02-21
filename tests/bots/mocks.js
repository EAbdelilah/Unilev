const { ethers } = require("ethers");

function createMockContract(address, abi, provider) {
    const mock = {
        getAddress: () => Promise.resolve(address),
        on: () => {},
        interface: new ethers.Interface(abi || [])
    };

    return new Proxy(mock, {
        get(target, prop) {
            if (prop in target) return target[prop];

            const method = (...args) => {
                // console.log(`Method call: ${prop}`);
                const res = target[prop] ? target[prop](...args) : ethers.ZeroAddress;
                return Promise.resolve(res);
            };

            // Handle .staticCall
            method.staticCall = method;

            return method;
        }
    });
}

module.exports = { createMockContract };
