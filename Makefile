-include .env

.PHONY: all test test-v4 clean patch-v4-core deploy-anvil deploy-polygon deploy-unichain deploy-unichain-sepolia deploy-unichain-sepolia-full add-pair

all: clean install update build

# Clean the repo
clean  :; forge clean

# Widen lib/v4-core's PoolManager pragma so the project builds with solc 0.8.27
# (v4-core@v4.0.0 hard-pins 0.8.26 while src/v4 requires 0.8.27). Idempotent.
patch-v4-core :; node scripts/patch-v4-core.cjs

# Remove modules
remove :; rm -rf .gitmodules && rm -rf .git/modules/* && rm -rf lib && touch .gitmodules && git add . && git commit -m "modules"

install :; forge install smartcontractkit/chainlink-brownie-contracts && forge install foundry-rs/forge-std && forge install OpenZeppelin/openzeppelin-contracts

# Update Dependencies
update:; forge update

build: patch-v4-core ; forge build --via-ir

sizer: patch-v4-core ; forge build --sizes --via-ir

compile: patch-v4-core ; forge compile --via-ir

# NOTE: -j 1 runs fork tests sequentially — running them in parallel (forge's
# default = # logical cores) bursts the RPC and trips free-tier rate limits (429).
test : patch-v4-core ; forge test --fork-url ${POLYGON_RPC_URL} -vv --via-ir -j 1 --fork-retry-backoff 2000
test-gas : patch-v4-core ; forge test --fork-url ${POLYGON_RPC_URL} -vv --gas-report --via-ir -j 1 --fork-retry-backoff 2000
# V4 suite (local mocks; the live-fork tests default to the public Unichain RPC)
# NOTE: --fork-retry-backoff deliberately NOT used here — it forces --fork-url,
# which these per-test forks don't pass; -j 1 alone keeps RPC pressure low.
test-v4 : patch-v4-core ; forge test --match-path "src/v4/test/**/*.t.sol" -vv --via-ir -j 1

slither :; slither ./src 

format :; prettier --write src/**/*.sol && prettier --write src/*.sol

# solhint should be installed globally
lint :; solhint src/**/*.sol && solhint src/*.sol

anvil :; anvil -m 'test test test test test test test test test test test junk' --fork-url ${POLYGON_RPC_URL}
anvil-polygon :; anvil -m 'test test test test test test test test test test test junk' --chain-id 137  --fork-url ${POLYGON_RPC_URL}

# This is the private key of account from the mnemonic from the "make anvil" command
deploy-anvil :; @forge script scripts/Deployments.s.sol:Deployments --via-ir --fork-url http://localhost:8545  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast

# Deploy to Polygon mainnet
deploy-polygon :; @forge script scripts/Deployments.s.sol:Deployments --via-ir --rpc-url ${POLYGON_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# --- V4 / Unichain ---

# Deploy V4 protocol to Unichain mainnet
deploy-unichain : patch-v4-core ; @forge script scripts/v4/DeployUnichain.s.sol:DeployUnichain --via-ir --rpc-url ${UNICHAIN_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# Deploy V4 protocol to Unichain Sepolia testnet
deploy-unichain-sepolia : patch-v4-core ; @forge script scripts/v4/DeployUnichainSepolia.s.sol:DeployUnichainSepolia --via-ir --rpc-url ${UNICHAIN_SEPOLIA_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# Deploy the FULL V4 solver/aggregator pipeline to Unichain Sepolia testnet
# (EswapCoWSettlement + EswapLeverageAdapter + EswapLeverageQuoter).
# Mode 1 (default): deploys a fresh lib+hook+router+keeper+adapter stack.
# Mode 2: set UNICHAIN_SEPOLIA_HOOK_ADDRESS + UNICHAIN_SEPOLIA_ROUTER_ADDRESS in
# .env to only wire the 3 pipeline contracts to an existing hook/router.
deploy-unichain-sepolia-full : patch-v4-core ; @forge script scripts/v4/DeployUnichainSepoliaFull.s.sol:DeployUnichainSepoliaFull --via-ir --rpc-url ${UNICHAIN_SEPOLIA_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# Add a NEW trading pair to the LIVE V4 protocol (no redeploy; env-driven, see script header)
add-pair : patch-v4-core ; @forge script scripts/v4/AddPair.s.sol:AddPair --via-ir --rpc-url ${UNICHAIN_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# --- V4 live trading scripts (Unichain mainnet, requires deployed contracts) ---
v4-setup         :; node javascript/v4/setup.js
v4-long-eth      :; node javascript/v4/openLong.js eth
v4-long-wbtc     :; node javascript/v4/openLong.js wbtc
v4-short-eth     :; node javascript/v4/openShort.js eth
v4-short-wbtc    :; node javascript/v4/openShort.js wbtc
v4-close-eth     :; node javascript/v4/closePosition.js eth
v4-close-wbtc    :; node javascript/v4/closePosition.js wbtc
v4-positions     :; node javascript/v4/checkPositions.js
