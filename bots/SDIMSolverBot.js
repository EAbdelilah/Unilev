/**
 * @title SDIMSolverBot.js
 * @notice Production-grade Off-Chain Solver Bot & SDK for the Solver-Delegated Intent-Margin (SDIM) Architecture.
 * This bot listens for signed EIP-712 Trader Margin Intents, evaluates execution capacity via the Eswap Hook,
 * matches them with liquidity, and signs/submits solver transactions directly to Uniswap V4.
 */

const { ethers } = require("ethers");

// 1. EIP-712 Domain and Typed Data Definitions
const DOMAIN_NAME = "EswapV4_SDIM";
const DOMAIN_VERSION = "1";

const EIP712_TYPES = {
    MarginIntent: [
        { name: "trader", type: "address" },
        { name: "poolId", type: "bytes32" },
        { name: "zeroForOne", type: "bool" },
        { name: "marginAmount", type: "uint256" },
        { name: "leverage", type: "uint8" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" }
    ]
};

/**
 * Creates EIP-712 Signature for a Trader Margin Intent
 */
async function signTraderIntent(wallet, chainId, routerAddress, intent) {
    const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: chainId,
        verifyingContract: routerAddress
    };

    return await wallet.signTypedData(domain, EIP712_TYPES, intent);
}

/**
 * Verifies EIP-712 Signature of a Trader Margin Intent
 */
function verifyTraderIntent(chainId, routerAddress, intent, signature) {
    const domain = {
        name: DOMAIN_NAME,
        version: DOMAIN_VERSION,
        chainId: chainId,
        verifyingContract: routerAddress
    };

    const recoveredAddress = ethers.verifyTypedData(domain, EIP712_TYPES, intent, signature);
    return recoveredAddress.toLowerCase() === intent.trader.toLowerCase();
}

/**
 * Main Solver Bot Logic
 */
class SDIMSolverBot {
    constructor(rpcUrl, privateKey, routerAddress, hookAddress) {
        this.provider = new ethers.JsonRpcProvider(rpcUrl);
        this.solverWallet = new ethers.Wallet(privateKey, this.provider);
        this.routerAddress = routerAddress;
        this.hookAddress = hookAddress;

        // Simplified ABIs for interacting with EswapRouter and EswapMarginHook
        this.routerAbi = [
            "function swap((tuple(address,address,uint24,int24,address),bool,int128,uint8,bytes)) external returns (bytes)"
        ];
        this.hookAbi = [
            "function getSwappableCapacity(address) external view returns (uint256)",
            "function isAuthorizedPool(bytes32) external view returns (bool)"
        ];

        this.routerContract = new ethers.Contract(routerAddress, this.routerAbi, this.solverWallet);
        this.hookContract = new ethers.Contract(hookAddress, this.hookAbi, this.solverWallet);
    }

    /**
     * Evaluates whether a signed Trader Intent is feasible for on-chain execution
     */
    async evaluateAndExecuteIntent(intent, signature, poolKey) {
        console.log(`[Solver] Evaluating intent from trader: ${intent.trader}`);

        // 1. Verify EIP-712 Signature
        const network = await this.provider.getNetwork();
        const isValid = verifyTraderIntent(Number(network.chainId), this.routerAddress, intent, signature);
        if (!isValid) {
            console.error("[Solver] ERROR: Invalid EIP-712 signature for intent!");
            return false;
        }
        console.log("[Solver] ✓ EIP-712 Signature Verified successfully.");

        // 2. Check if Pool is authorized in Eswap Hook
        const isAuthorized = await this.hookContract.isAuthorizedPool(intent.poolId);
        if (!isAuthorized) {
            console.error(`[Solver] ERROR: Pool ${intent.poolId} is not authorized on Hook!`);
            return false;
        }

        // 3. Query Swappable Capacity on Hook
        const inputCurrency = intent.zeroForOne ? poolKey.currency0 : poolKey.currency1;
        const capacity = await this.hookContract.getSwappableCapacity(inputCurrency);
        const requiredLiquidity = BigInt(intent.marginAmount) * BigInt(intent.leverage - 1);

        if (capacity < requiredLiquidity) {
            console.warn(`[Solver] WARNING: Insufficient swappable capacity in Hook! Required: ${requiredLiquidity}, Available: ${capacity}`);
            return false;
        }
        console.log(`[Solver] ✓ Sufficient capacity found. Proceeding with solver match...`);

        // 4. Formulate the swap transaction payload
        // We pack the margin parameters into hookData
        const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
            ["bool", "uint8", "address"],
            [true, intent.leverage, intent.trader]
        );

        const swapParams = {
            key: {
                currency0: poolKey.currency0,
                currency1: poolKey.currency1,
                fee: poolKey.fee,
                tickSpacing: poolKey.tickSpacing,
                hooks: poolKey.hooks
            },
            zeroForOne: intent.zeroForOne,
            amountSpecified: -BigInt(intent.marginAmount), // negative indicates exact input
            leverage: intent.leverage,
            hookData: hookData
        };

        try {
            console.log("[Solver] Submitting EswapRouter.swap() transaction...");
            const tx = await this.routerContract.swap(swapParams, {
                gasLimit: 5000000
            });
            console.log(`[Solver] Transaction submitted! Hash: ${tx.hash}`);
            const receipt = await tx.wait();
            console.log(`[Solver] ✓ Transaction successfully mined in block ${receipt.blockNumber}!`);
            return true;
        } catch (error) {
            console.error(`[Solver] ERROR: Failed to execute transaction on-chain: ${error.message}`);
            return false;
        }
    }
}

module.exports = {
    signTraderIntent,
    verifyTraderIntent,
    SDIMSolverBot
};
