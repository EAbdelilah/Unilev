const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const sourceEnvPath = path.join(__dirname, '../.env');
const targetEnvPath = path.join(__dirname, '../dashboard/.env');
const projectRoot = path.join(__dirname, '..');

// Helper to copy file
function copyFile(src, dest) {
    if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        console.log(`✅ Copied ${path.basename(src)} to ${dest}`);
    } else {
        console.warn(`⚠️  Source file not found: ${src}`);
    }
}

// 1. Update Dashboard .env
console.log("🔄 Syncing Environment Variables...");

const envVars = [
    { key: 'WRAPPER_ADDRESS', target: 'NEXT_PUBLIC_WRAPPER_ADDRESS' },
    { key: 'PRICEFEEDL1_ADDRESS', target: 'NEXT_PUBLIC_PRICEFEEDL1_ADDRESS' },
    { key: 'POSITIONS_ADDRESS', target: 'NEXT_PUBLIC_POSITIONS_ADDRESS' },
    { key: 'MARKET_ADDRESS', target: 'NEXT_PUBLIC_MARKET_ADDRESS' },
    { key: 'LIQUIDITYPOOLFACTORY_ADDRESS', target: 'NEXT_PUBLIC_LIQUIDITYPOOLFACTORY_ADDRESS' },
    { key: 'FEEMANAGER_ADDRESS', target: 'NEXT_PUBLIC_FEEMANAGER_ADDRESS' },
    { key: 'POLYGON_RPC_URL', target: 'NEXT_PUBLIC_RPC_URL' },
    { key: 'UNICHAIN_RPC_URL', target: 'NEXT_PUBLIC_UNICHAIN_RPC_URL' },
    { key: 'UNICHAIN_SEPOLIA_RPC_URL', target: 'NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL' },
    { key: 'V4_HOOK_ADDRESS', target: 'NEXT_PUBLIC_V4_HOOK_ADDRESS' },
    { key: 'V4_ROUTER_ADDRESS', target: 'NEXT_PUBLIC_V4_ROUTER_ADDRESS' },
    { key: 'V4_KEEPER_ADDRESS', target: 'NEXT_PUBLIC_V4_KEEPER_ADDRESS' },
    { key: 'V4_ADAPTER_ADDRESS', target: 'NEXT_PUBLIC_V4_ADAPTER_ADDRESS' },
    { key: 'V4_PRICEFEED_ADDRESS', target: 'NEXT_PUBLIC_V4_PRICEFEED_ADDRESS' },
    { key: 'V4_SOLVER_ADDRESS', target: 'NEXT_PUBLIC_V4_SOLVER_ADDRESS' },
    { key: 'V4_QUOTER_ADDRESS', target: 'NEXT_PUBLIC_V4_QUOTER_ADDRESS' },
    { key: 'V4_SETTLEMENT_ADDRESS', target: 'NEXT_PUBLIC_V4_SETTLEMENT_ADDRESS' },
    { key: 'V4_TIMELOCK_ADDRESS', target: 'NEXT_PUBLIC_V4_TIMELOCK_ADDRESS' },
];

let envContent = '';
envVars.forEach(v => {
    const value = process.env[v.key];
    if (value) {
        envContent += `${v.target}=${value}\n`;
    } else {
        console.warn(`⚠️  Missing ${v.key} in root .env`);
    }
});

fs.writeFileSync(targetEnvPath, envContent);
console.log(`✅ Updated dashboard/.env`);

// Copy supported_tokens.json
const tokensSrc = path.join(projectRoot, 'supported_tokens.json');
const tokensDest = path.join(projectRoot, 'dashboard/src/config/supported_tokens.json');
copyFile(tokensSrc, tokensDest);

// 2. Update ABIs
console.log("\n🔄 Syncing ABIs...");

const abis = [
    'Market',
    'Positions',
    'PriceFeedL1',
    'LiquidityPoolFactory',
    'LiquidityPool',
    'ERC20',
    'UniswapV3Helper',
    'EswapRouter',
    'EswapMarginHook',
    'PriceFeed',
    'EswapLeverageAdapter',
    'EswapLeverageQuoter',
    'EswapSettlement',
    'EswapTimelock',
];

abis.forEach(contractName => {
    const src = path.join(projectRoot, `out/${contractName}.sol/${contractName}.json`);
    const dest = path.join(projectRoot, `dashboard/src/abis/${contractName}.json`);
    copyFile(src, dest);
});

console.log("\n✨ Dashboard update complete!");
