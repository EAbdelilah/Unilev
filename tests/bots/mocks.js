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
                if (target[prop]) {
                    return Promise.resolve(target[prop](...args));
                }
                // Default mock response for contract write methods
                return Promise.resolve({
                    wait: () => Promise.resolve({ status: 1 }),
                    hash: "0x" + "0".repeat(64)
                });
            };

            // Handle .staticCall
            method.staticCall = method;

            return method;
        }
    });
}

module.exports = { createMockContract };
