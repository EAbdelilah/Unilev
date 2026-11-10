/** Bytecode-shaped ERC20 surface (safe on USDC proxy + native-origin WETH/WBTC). */
export declare const ERC20_ABI: readonly [{
    readonly name: "balanceOf";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "account";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "allowance";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "owner";
        readonly type: "address";
    }, {
        readonly name: "spender";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "approve";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "spender";
        readonly type: "address";
    }, {
        readonly name: "value";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly type: "bool";
    }];
}];
/** EswapRouter (Base mainnet) — trader-facing margin surfaces. */
export declare const ESWAP_ROUTER_ABI: readonly [{
    readonly name: "quoteExactInput";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "key";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "currency0";
            readonly type: "address";
        }, {
            readonly name: "currency1";
            readonly type: "address";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "tickSpacing";
            readonly type: "int24";
        }, {
            readonly name: "hooks";
            readonly type: "address";
        }];
    }, {
        readonly name: "zeroForOne";
        readonly type: "bool";
    }, {
        readonly name: "amountSpecified";
        readonly type: "int128";
    }, {
        readonly name: "leverage";
        readonly type: "uint8";
    }];
    readonly outputs: readonly [{
        readonly name: "amountOut";
        readonly type: "int128";
    }];
}, {
    readonly name: "swapMultiPool";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly name: "params";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "key";
            readonly type: "tuple";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
            }];
        }, {
            readonly name: "standardPoolKey";
            readonly type: "tuple";
            readonly components: readonly [{
                readonly name: "currency0";
                readonly type: "address";
            }, {
                readonly name: "currency1";
                readonly type: "address";
            }, {
                readonly name: "fee";
                readonly type: "uint24";
            }, {
                readonly name: "tickSpacing";
                readonly type: "int24";
            }, {
                readonly name: "hooks";
                readonly type: "address";
            }];
        }, {
            readonly name: "zeroForOne";
            readonly type: "bool";
        }, {
            readonly name: "amountSpecified";
            readonly type: "int256";
        }, {
            readonly name: "leverage";
            readonly type: "uint8";
        }, {
            readonly name: "solver";
            readonly type: "address";
        }, {
            readonly name: "hookData";
            readonly type: "bytes";
        }, {
            readonly name: "deadline";
            readonly type: "uint256";
        }, {
            readonly name: "minAmountOut";
            readonly type: "uint256";
        }];
    }];
    readonly outputs: readonly [{
        readonly type: "bytes";
    }];
}, {
    readonly name: "erc20BorrowEscrow";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "solver";
        readonly type: "address";
    }, {
        readonly name: "token";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly type: "uint256";
    }];
}, {
    readonly name: "depositBorrowEscrow";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "token";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}];
/** EswapMarginHook (Base mainnet) — read-only preview surfaces. */
export declare const ESWAP_HOOK_ABI: readonly [{
    readonly name: "quoteOpenFit";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "key";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "currency0";
            readonly type: "address";
        }, {
            readonly name: "currency1";
            readonly type: "address";
        }, {
            readonly name: "fee";
            readonly type: "uint24";
        }, {
            readonly name: "tickSpacing";
            readonly type: "int24";
        }, {
            readonly name: "hooks";
            readonly type: "address";
        }];
    }, {
        readonly name: "trader";
        readonly type: "address";
    }, {
        readonly name: "inputCurrency";
        readonly type: "address";
    }, {
        readonly name: "leverage";
        readonly type: "uint8";
    }, {
        readonly name: "marginAmount";
        readonly type: "uint256";
    }, {
        readonly name: "borrowedAmount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "fits";
        readonly type: "bool";
    }, {
        readonly name: "reason";
        readonly type: "string";
    }];
}, {
    readonly name: "openInterestCapacity";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [];
    readonly outputs: readonly [{
        readonly name: "capsActive";
        readonly type: "bool";
    }, {
        readonly name: "poolTvlUsd";
        readonly type: "uint256";
    }, {
        readonly name: "totalOiUsd";
        readonly type: "uint256";
    }, {
        readonly name: "maxSingleTradeUsd";
        readonly type: "uint256";
    }, {
        readonly name: "remainingOiUsd";
        readonly type: "uint256";
    }];
}, {
    readonly name: "standardPoolKeys";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "poolId";
        readonly type: "bytes32";
    }];
    readonly outputs: readonly [{
        readonly name: "currency0";
        readonly type: "address";
    }, {
        readonly name: "currency1";
        readonly type: "address";
    }, {
        readonly name: "fee";
        readonly type: "uint24";
    }, {
        readonly name: "tickSpacing";
        readonly type: "int24";
    }, {
        readonly name: "hooks";
        readonly type: "address";
    }];
}];
//# sourceMappingURL=abis.d.ts.map