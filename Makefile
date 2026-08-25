-include .env

.PHONY: all test test-v4 clean deploy-anvil deploy-polygon deploy-unichain deploy-unichain-sepolia

all: clean install update build

# Clean the repo
clean  :; forge clean

# Remove modules
remove :; rm -rf .gitmodules && rm -rf .git/modules/* && rm -rf lib && touch .gitmodules && git add . && git commit -m "modules"

install :; forge install smartcontractkit/chainlink-brownie-contracts && forge install foundry-rs/forge-std && forge install OpenZeppelin/openzeppelin-contracts

# Update Dependencies
update:; forge update

build:; forge build --via-ir

sizer:; forge build --sizes --via-ir

compile:; forge compile --via-ir

test :; forge test --fork-url ${POLYGON_RPC_URL} -vv --via-ir 
test-gas :; forge test --fork-url ${POLYGON_RPC_URL} -vv --gas-report --via-ir 
# V4 suite (no fork required; uses local mocks)
test-v4 :; forge test --match-path "src/v4/test/**/*.t.sol" -vv --via-ir

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
deploy-unichain :; @forge script scripts/v4/DeployUnichain.s.sol:DeployUnichain --via-ir --rpc-url ${UNICHAIN_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# Deploy V4 protocol to Unichain Sepolia testnet
deploy-unichain-sepolia :; @forge script scripts/v4/DeployUnichainSepolia.s.sol:DeployUnichainSepolia --via-ir --rpc-url ${UNICHAIN_SEPOLIA_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

# Add a NEW trading pair to the LIVE V4 protocol (no redeploy; env-driven, see script header)
add-pair :; @forge script scripts/v4/AddPair.s.sol:AddPair --via-ir --rpc-url ${UNICHAIN_RPC_URL} --private-key ${PRIVATE_KEY} --broadcast --slow

