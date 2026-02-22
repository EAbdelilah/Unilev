const { ethers } = require("ethers");
const { createMockContract } = require("./mocks");

// Mocking the utils before they are required by the bots
const utils = require("../../javascript/utils");

const mockEnv = {
    RPC_URL: "http://localhost:8545",
    PRIVATE_KEY: "0x" + "1".repeat(64),
    WETH: ethers.getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"),
    USDC: ethers.getAddress("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"),
    WBTC: ethers.getAddress("0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"),
    PRICEFEEDL1_ADDRESS: ethers.ZeroAddress,
    POSITIONS_ADDRESS: ethers.ZeroAddress,
    UNISWAPV3HELPER_ADDRESS: ethers.ZeroAddress,
    MARKET_ADDRESS: ethers.ZeroAddress,
    FEEMANAGER_ADDRESS: ethers.ZeroAddress,
    LIQUIDITYPOOLFACTORY_ADDRESS: ethers.ZeroAddress,
    USDC_LP: ethers.ZeroAddress,
    STRATEGY_EXECUTOR_ADDRESS: ethers.ZeroAddress
};

utils.getEnvVars = () => mockEnv;
utils.setupProviderAndWallet = () => {
    const provider = {
        getTransactionCount: () => Promise.resolve(1),
        getFeeData: () => Promise.resolve({ gasPrice: ethers.parseUnits("1", "gwei") }),
        sendTransaction: () => Promise.resolve({ wait: () => Promise.resolve({ status: 1 }), hash: "0x" + "0".repeat(64) }),
        call: (params) => {
            // console.log("Call data:", params.data);
            // Mocking FeeManager.getFees(address) return [100, 500]
            // getFees(address) -> (uint256, uint256)
            // Selector might be different if it's not getFees(address)
            if (params.data && params.data.includes("542617c4")) {
                return Promise.resolve(ethers.AbiCoder.defaultAbiCoder().encode(["uint256", "uint256"], [100n, 500n]));
            }
            return Promise.resolve("0x");
        },
        estimateGas: () => Promise.resolve(100000n),
        broadcastTransaction: () => Promise.resolve({ wait: () => Promise.resolve({ status: 1 }), hash: "0x" + "0".repeat(64) }),
        getNetwork: () => Promise.resolve({ chainId: 1n, name: "mainnet" }),
        send: () => Promise.resolve(),
        on: () => {},
        _isProvider: true
    };

    const wallet = new ethers.Wallet(mockEnv.PRIVATE_KEY);
    // Manually setting provider for the mock wallet
    Object.defineProperty(wallet, "provider", { value: provider, writable: true });
    wallet.connect = () => wallet;

    return { provider, wallet };
};

utils.getAbi = () => [];
utils.getMarketAbi = () => [];
utils.getPositionsAbi = () => [];
utils.getPriceFeedL1Abi = () => [];
utils.getLiquidityPoolFactoryAbi = () => [];
utils.getLiquidityPoolAbi = () => [];
utils.getUniswapV3HelperAbi = () => [];
utils.getQuoterAbi = () => [];
utils.getStrategyExecutorAbi = () => [];

// Mocking contract creation in BotBase would be better
// But since we can't easily change the constructor logic without editing the file,
// we can mock the ethers.Contract constructor.

const originalContract = ethers.Contract;
try {
    Object.defineProperty(ethers, "Contract", {
        value: function(address, abi, runner) {
            const mock = createMockContract(address, abi, runner);
            // Add default behavior for FeeManager if requested
    // Enhanced default behavior for view methods
    mock.getFees = () => Promise.resolve([100n, 500n]);
    mock.getTokenLatestPriceInUsd = () => Promise.resolve(ethers.parseUnits("1", 18));
    mock.getPairLatestPrice = () => Promise.resolve(ethers.parseUnits("1", 18));
    mock.getPositionParams = () => Promise.resolve([ethers.ZeroAddress, ethers.ZeroAddress, 0n, 0n, false]);
    mock.getTraderPositions = () => Promise.resolve([]);
    mock.getTokenToLiquidityPools = () => Promise.resolve(ethers.ZeroAddress);
            return mock;
        },
        configurable: true,
        writable: true
    });
} catch (e) {
    ethers.Contract = function(address, abi, runner) {
        const mock = createMockContract(address, abi, runner);
        if (typeof abi === "object" && abi.some && abi.some(s => s.includes("getFees"))) {
            mock.getFees = () => Promise.resolve([100n, 500n]);
        }
        return mock;
    };
}

// Also for ethers v6, we might need to mock Contract class differently if it's used as a class
// But usually function-based mock works for 'new'

module.exports = { mockEnv };
