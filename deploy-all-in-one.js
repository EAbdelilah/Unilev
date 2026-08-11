// SPDX-License-Identifier: MIT
/**
 * @title Deploy-All-In-One Master Orchestrator for Eswap Spot Margin DEX
 * @notice Automates the entire deployment, configuration, frontend sync, and solver activation in a single command.
 *
 * Steps executed automatically:
 * 1. Executes Forge DeployUnichain script on Unichain Mainnet.
 * 2. Parses the deployed contract addresses from Forge's broadcast JSON output.
 * 3. Updates the root .env file with the newly deployed addresses.
 * 4. Runs javascript/update-dashboard.js to compile ABIs and address maps directly into the React frontend.
 * 5. Executes ERC20 approve() transactions for WETH and USDC from your solver key to instantly activate solver liquidity.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('fs/promises');
const { ethers } = require('ethers');

// Load root .env variables safely
require('dotenv').config();

const RPC_URL = process.env.ETH_RPC_URL || 'https://unichain-rpc.gateway.fm';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const WETH = '0x4200000000000000000000000000000000000006';
const USDC = '0x078D782b760474a361dDA0AF3839290b0EF57AD6';

async function main() {
    if (!PRIVATE_KEY) {
        console.error('❌ Error: PRIVATE_KEY is missing in your root .env file!');
        process.exit(1);
    }

    console.log('🔄 Step 1: Building optimized smart contracts and running Forge deployment...');
    try {
        execSync(
            `export PATH="/home/jules/.foundry/bin:$PATH" && forge script scripts/v4/DeployUnichain.s.sol --rpc-url ${RPC_URL} --broadcast --private-key ${PRIVATE_KEY} --slow`,
            { stdio: 'inherit' }
        );
        console.log('✅ Forge deployment completed successfully!');
    } catch (err) {
        console.error('❌ Error executing Forge deployment:', err.message);
        process.exit(1);
    }

    console.log('\n🔄 Step 2: Parsing newly deployed contract addresses from Forge broadcast...');
    let hookAddress, routerAddress, keeperAddress, priceFeedAddress, chainId;

    try {
        const broadcastDir = './broadcast/DeployUnichain.s.sol';
        const chainDirs = fs.readdirSync(broadcastDir).filter(f => fs.statSync(`${broadcastDir}/${f}`).isDirectory());

        if (chainDirs.length === 0) {
            throw new Error('No chain directory found in broadcast/');
        }

        // Target the latest modified or highest chain ID folder
        chainId = chainDirs[0];
        const runLatestPath = `${broadcastDir}/${chainId}/run-latest.json`;
        console.log(`Reading Forge broadcast output: ${runLatestPath}`);

        const runLatest = JSON.parse(fs.readFileSync(runLatestPath, 'utf8'));
        const txs = runLatest.transactions || [];

        for (const tx of txs) {
            if (tx.transactionType === 'CREATE') {
                if (tx.contractName === 'EswapMarginHook') hookAddress = tx.contractAddress;
                if (tx.contractName === 'EswapRouter') routerAddress = tx.contractAddress;
                if (tx.contractName === 'EswapLiquidationKeeper') keeperAddress = tx.contractAddress;
                if (tx.contractName === 'PriceFeed') priceFeedAddress = tx.contractAddress;
            }
        }

        if (!hookAddress || !routerAddress) {
            throw new Error('Failed to find Hook or Router addresses in broadcast JSON.');
        }

        console.log(`✅ Extracted Hook: ${hookAddress}`);
        console.log(`✅ Extracted Router: ${routerAddress}`);
        console.log(`✅ Extracted Keeper: ${keeperAddress}`);
        console.log(`✅ Extracted PriceFeed: ${priceFeedAddress}`);
    } catch (err) {
        console.error('❌ Failed to parse deployed addresses from broadcast. Please configure manually.', err.message);
        process.exit(1);
    }

    console.log('\n🔄 Step 3: Updating root .env variables...');
    try {
        const envPath = './.env';
        let envContent = '';
        if (fs.existsSync(envPath)) {
            envContent = fs.readFileSync(envPath, 'utf8');
        }

        // Function to update or append variable
        const updateEnvVar = (name, value) => {
            const regex = new RegExp(`^${name}=.*`, 'm');
            if (regex.test(envContent)) {
                envContent = envContent.replace(regex, `${name}=${value}`);
            } else {
                envContent += `\n${name}=${value}`;
            }
        };

        updateEnvVar('V4_HOOK_ADDRESS', hookAddress);
        updateEnvVar('V4_ROUTER_ADDRESS', routerAddress);
        updateEnvVar('V4_KEEPER_ADDRESS', keeperAddress);
        updateEnvVar('V4_PRICEFEED_ADDRESS', priceFeedAddress);

        fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
        console.log('✅ Updated root .env file successfully!');
    } catch (err) {
        console.error('❌ Failed to update root .env file:', err.message);
        process.exit(1);
    }

    console.log('\n🔄 Step 4: Synchronizing ABIs and live addresses to React dashboard...');
    try {
        execSync('node javascript/update-dashboard.js', { stdio: 'inherit' });
        console.log('✅ Dashboard successfully synced and configured!');
    } catch (err) {
        console.error('❌ Failed to sync dashboard:', err.message);
        process.exit(1);
    }

    console.log('\n🔄 Step 5: Automatically executing ERC20 approve() for Solver activation...');
    try {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

        console.log(`Connected to Solver wallet: ${wallet.address}`);
        console.log('Submitting infinite approvals for WETH and USDC to EswapRouter...');

        const erc20Abi = [
            'function approve(address spender, uint256 amount) public returns (bool)'
        ];

        const wethContract = new ethers.Contract(WETH, erc20Abi, wallet);
        const usdcContract = new ethers.Contract(USDC, erc20Abi, wallet);

        // Unlimited approval
        const maxApproval = ethers.MaxUint256;

        const wethTx = await wethContract.approve(routerAddress, maxApproval);
        console.log(`Approval transaction submitted for WETH: ${wethTx.hash}`);
        await wethTx.wait();
        console.log('✅ WETH approval confirmed on-chain!');

        const usdcTx = await usdcContract.approve(routerAddress, maxApproval);
        console.log(`Approval transaction submitted for USDC: ${usdcTx.hash}`);
        await usdcTx.wait();
        console.log('✅ USDC approval confirmed on-chain!');

        console.log('\n🌟 SUCCESS: The entire Eswap DEX is 100% live, synchronized, and solver-activated in one go! 🌟');
    } catch (err) {
        console.warn('⚠️ Warning: Failed to execute automated solver approvals. You may need to execute them manually.', err.message);
    }
}

main();
