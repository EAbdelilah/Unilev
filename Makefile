-include .env

.PHONY: all test clean deploy-anvil

all: clean install update build

# Clean the repo
clean  :; forge clean

# Remove modules
remove :; rm -rf .gitmodules && rm -rf .git/modules/* && rm -rf lib && touch .gitmodules && git add . && git commit -m "modules"

install :; forge install smartcontractkit/chainlink-brownie-contracts && forge install rari-capital/solmate && forge install foundry-rs/forge-std && forge install OpenZeppelin/openzeppelin-contracts

# Update Dependencies
update:; forge update

build:; forge build --via-ir

sizer:; forge build --sizes --via-ir

compile:; forge compile --via-ir

test :; forge test --fork-url ${ETH_RPC_URL} -vv --via-ir 
test-gas :; forge test --fork-url ${ETH_RPC_URL} -vv --gas-report --via-ir 

slither :; slither ./src 

format :; prettier --write src/**/*.sol && prettier --write src/*.sol

# solhint should be installed globally
lint :; solhint src/**/*.sol && solhint src/*.sol

anvil :; anvil -m 'test test test test test test test test test test test junk' --fork-url ${ETH_RPC_URL}

# This is the private key of account from the mnemonic from the "make anvil" command
deploy-anvil :; @forge script src/scripts/Deployments.s.sol:Deployments --via-ir --fork-url http://localhost:8545  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast 

deploy-polygon:
	@if [ -z "$${POLYGON_RPC_URL}" ]; then \
		echo "Error: POLYGON_RPC_URL is not set. Please set it in your environment or .env file."; \
		exit 1; \
	fi
	@if [ -z "$${POLYGON_PRIVATE_KEY}" ]; then \
		echo "Error: POLYGON_PRIVATE_KEY is not set. Please set it in your environment or .env file."; \
		exit 1; \
	fi
	@if [ -z "$${POLYGONSCAN_API_KEY}" ]; then \
		echo "Error: POLYGONSCAN_API_KEY is not set. Please set it in your environment or .env file. Verification will be skipped if not provided, but the command might fail if the flag is present without a value."; \
	fi
	@echo "Using POLYGON_RPC_URL: $${POLYGON_RPC_URL}"
	@forge script src/scripts/Deployments.s.sol:Deployments --via-ir --rpc-url $${POLYGON_RPC_URL} --private-key $${POLYGON_PRIVATE_KEY} --broadcast --verify --etherscan-api-key $${POLYGONSCAN_API_KEY} --legacy
