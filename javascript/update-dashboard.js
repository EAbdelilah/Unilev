/**
 * Syncs the Next.js dashboard with the currently deployed contracts.
 *
 * Two rules this script enforces deliberately:
 *
 *  1. It never publishes a secret. `NEXT_PUBLIC_*` values are inlined into the
 *     browser bundle, so anything written here is public the moment the app
 *     builds. Root `.env` RPC URLs are provider endpoints that usually embed an
 *     API key, so they are NEVER auto-promoted to `NEXT_PUBLIC_*`; the script
 *     only publishes explicitly-public endpoints and re-checks the final value
 *     for key-like patterns before writing. See `_assertPublishable()`.
 *
 *  2. It copies `abi` only, not the whole Foundry artifact. Artifacts embed
 *     bytecode, metadata and source maps, which multiplies the payload several
 *     times over (EswapMarginHook: 375 KB artifact -> 50 KB ABI) for data the
 *     browser never uses.
 *
 * Usage: node javascript/update-dashboard.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const projectRoot = path.join(__dirname, '..');

// Next.js reads `.env.local` ahead of `.env`, so that is the file that must be
// authoritative. The previous version wrote `.env`, which silently loses to any
// stale `.env.local` a developer already had on disk.
const targetEnvPath = path.join(projectRoot, 'dashboard/.env.local');
const staleEnvPath = path.join(projectRoot, 'dashboard/.env');

const CHAIN_ID = '130';
const UNICHAIN_PUBLIC_RPC_FALLBACK = 'https://mainnet.unichain.org';
const POLYGON_PUBLIC_RPC_FALLBACK = 'https://polygon-rpc.com';

// Substrings that indicate a value is a credential rather than a public URL.
// The provider pattern must tolerate the `host/vN/<key>` shape
// (e.g. `x.g.alchemy.com/v2/alch_...`) -- an earlier version required the key to
// start immediately after `vN` and therefore missed every real Alchemy URL.
// For these providers any path segment is treated as the key, so this fails
// closed: we never intend to publish a keyed provider URL in the first place,
// and a false positive is a missing var rather than a leaked credential.
const KEY_PATTERNS = [
    /api[_-]?key/i,
    /secret/i,
    /access[_-]?token/i,
    /(alchemy|infura|ankr|llamarpc|quicknode|drpc|blastapi|base\.org)\.[a-z.]+\/\S+/i,
];

// Backstop: any path segment of 24+ chars mixing letters and digits with no dot
// in it is an opaque token, not a human-written URL path.
const OPAQUE_TOKEN = /\/[A-Za-z0-9_-]{24,}(?:$|[/?#])/;

/**
 * Refuse to publish anything that looks like a credential.
 * @param {string} value
 * @param {string} name target variable name, used in the error message
 */
function _assertPublishable(value, name) {
    if (KEY_PATTERNS.some((re) => re.test(value)) || OPAQUE_TOKEN.test(value)) {
        throw new Error(
            `Refusing to write ${name}: the value looks like a provider credential.\n` +
                `NEXT_PUBLIC_* values are inlined into the browser bundle, so this would be public.\n` +
                `Set an explicitly public endpoint (PUBLIC_UNICHAIN_RPC_URL / PUBLIC_RPC_URL / ` +
                `PUBLIC_UNICHAIN_SEPOLIA_RPC_URL) or remove ${name} from the mapping.`
        );
    }
}

/**
 * Self-test for the credential guard. This exists because the guard has already
 * been wrong once in a way that would have published a live API key, and a
 * regex that fails open is worse than no guard at all.
 */
function _selftest() {
    // NOTE: these fixtures are synthetic and deliberately not the real keys that
    // live in the untracked root .env. Never paste a live credential here.
    const mustReject = [
        'https://unichain-sepolia.g.alchemy.com/v2/alch_SYNTHETIC0000000000000000',
        'https://mainnet.infura.io/v3/0123456789abcdef0123456789abcdef',
        'https://eth-mainnet.g.alchemy.com/v2/SHORTKEY',
        'https://rpc.ankr.com/eth/0123456789abcdef0123456789abcdef',
        'https://example.com/?apikey=supersecretvalue',
        'https://example.com/0123456789abcdef0123456789abcdef01',
    ];
    const mustAllow = [
        'https://mainnet.unichain.org',
        'https://sepolia.unichain.org',
        'https://polygon-rpc.com',
        '0xdF768b7eb6A76594b21177bb0Cd55bA433D290c8',
        '130',
        'https://example.com/some/nested/public/path',
    ];

    let failures = 0;
    mustReject.forEach((v) => {
        try {
            _assertPublishable(v, 'TEST');
            console.error(`  ✗ should have rejected: ${v}`);
            failures++;
        } catch {
            /* expected */
        }
    });
    mustAllow.forEach((v) => {
        try {
            _assertPublishable(v, 'TEST');
        } catch {
            console.error(`  ✗ wrongly rejected: ${v}`);
            failures++;
        }
    });

    if (failures) {
        console.error(`\n❌ credential guard self-test FAILED (${failures} problem(s))`);
        process.exit(1);
    }
    console.log('✅ credential guard self-test passed (11 cases)');
    process.exit(0);
}

if (process.argv.includes('--selftest')) {
    _selftest();
}

function copyFile(src, dest) {
    if (!fs.existsSync(src)) {
        console.warn(`  ⚠️  source not found: ${path.relative(projectRoot, src)}`);
        return false;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`  ✅ ${path.basename(src)} -> ${path.relative(projectRoot, dest)}`);
    return true;
}

// 1. Env -------------------------------------------------------------------------

console.log('🔄 Syncing environment variables...');

const envVars = [
    // V1 Polygon deployment
    { key: 'WRAPPER_ADDRESS', target: 'NEXT_PUBLIC_WRAPPER_ADDRESS' },
    { key: 'PRICEFEEDL1_ADDRESS', target: 'NEXT_PUBLIC_PRICEFEEDL1_ADDRESS' },
    { key: 'POSITIONS_ADDRESS', target: 'NEXT_PUBLIC_POSITIONS_ADDRESS' },
    { key: 'MARKET_ADDRESS', target: 'NEXT_PUBLIC_MARKET_ADDRESS' },
    { key: 'LIQUIDITYPOOLFACTORY_ADDRESS', target: 'NEXT_PUBLIC_LIQUIDITYPOOLFACTORY_ADDRESS' },
    { key: 'FEEMANAGER_ADDRESS', target: 'NEXT_PUBLIC_FEEMANAGER_ADDRESS' },

    // V4 Unichain deployment (the one the dashboard trades against).
    // `required` here means "the dashboard cannot trade without it" -- these three
    // are the ones the read/write hooks dereference directly. The rest are
    // surfaced with `|| ''` fallbacks in the UI, so they are synced opportunistically.
    { key: 'V4_HOOK_ADDRESS', target: 'NEXT_PUBLIC_V4_HOOK_ADDRESS', required: true },
    { key: 'V4_ROUTER_ADDRESS', target: 'NEXT_PUBLIC_V4_ROUTER_ADDRESS', required: true },
    { key: 'V4_PRICEFEED_ADDRESS', target: 'NEXT_PUBLIC_V4_PRICEFEED_ADDRESS', required: true },
    { key: 'V4_ROUTER_EXT_ADDRESS', target: 'NEXT_PUBLIC_V4_ROUTER_EXT_ADDRESS' },
    { key: 'V4_KEEPER_ADDRESS', target: 'NEXT_PUBLIC_V4_KEEPER_ADDRESS' },
    { key: 'V4_ADAPTER_ADDRESS', target: 'NEXT_PUBLIC_V4_ADAPTER_ADDRESS' },
    { key: 'V4_QUOTER_ADDRESS', target: 'NEXT_PUBLIC_V4_QUOTER_ADDRESS' },
    { key: 'V4_SETTLEMENT_ADDRESS', target: 'NEXT_PUBLIC_V4_SETTLEMENT_ADDRESS' },
    { key: 'V4_TIMELOCK_ADDRESS', target: 'NEXT_PUBLIC_V4_TIMELOCK_ADDRESS' },
    { key: 'V4_SOLVER_ADDRESS', target: 'NEXT_PUBLIC_V4_SOLVER_ADDRESS' },
    // Not yet read by the dashboard; synced so the UI has them when it grows
    // oracle-source and router-extension views.
    { key: 'USDC_TWAP_FEED', target: 'NEXT_PUBLIC_USDC_TWAP_FEED' },
    { key: 'ETH_TWAP_FEED', target: 'NEXT_PUBLIC_ETH_TWAP_FEED' },

    // Sandbox
    { key: 'UNICHAIN_SEPOLIA_HOOK_ADDRESS', target: 'NEXT_PUBLIC_UNICHAIN_SEPOLIA_HOOK_ADDRESS' },
    { key: 'UNICHAIN_SEPOLIA_ROUTER_ADDRESS', target: 'NEXT_PUBLIC_UNICHAIN_SEPOLIA_ROUTER_ADDRESS' },

    { key: 'REQUIRE_TWAP_ORACLE', target: 'NEXT_PUBLIC_REQUIRE_TWAP_ORACLE' },
    { key: 'MIN_COLLATERAL_USD', target: 'NEXT_PUBLIC_MIN_COLLATERAL_USD' },

    // Operator/app config rather than deployment output. Synced so this script
    // stays the single place dashboard configuration comes from. These are
    // public-by-design values (a DSN and a project id are not secrets).
    { key: 'ADMIN_WALLETS', target: 'NEXT_PUBLIC_ADMIN_WALLETS' },
    { key: 'WC_PROJECT_ID', target: 'NEXT_PUBLIC_WC_PROJECT_ID' },
    { key: 'SENTRY_DSN', target: 'NEXT_PUBLIC_SENTRY_DSN' },
];

const derivedEnv = [
    {
        target: 'NEXT_PUBLIC_CHAIN_ID',
        value: CHAIN_ID,
    },
    {
        // Public, unkeyed endpoints only. Deliberately NOT sourced from
        // UNICHAIN_RPC_URL / POLYGON_RPC_URL, which embed provider API keys.
        target: 'NEXT_PUBLIC_UNICHAIN_RPC_URL',
        value: process.env.PUBLIC_UNICHAIN_RPC_URL || UNICHAIN_PUBLIC_RPC_FALLBACK,
    },
    {
        target: 'NEXT_PUBLIC_RPC_URL',
        value: process.env.PUBLIC_RPC_URL || POLYGON_PUBLIC_RPC_FALLBACK,
    },
    {
        // Only published when the operator explicitly supplies a public endpoint.
        // The root UNICHAIN_SEPOLIA_RPC_URL embeds an Alchemy key, and the app
        // already falls back to its own public endpoint when this is absent.
        target: 'NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL',
        value: process.env.PUBLIC_UNICHAIN_SEPOLIA_RPC_URL || null,
    },
];

const lines = [];
const missingRequired = [];

envVars.forEach(({ key, target, required }) => {
    const value = process.env[key];
    if (!value) {
        if (required) {
            missingRequired.push(key);
        } else {
            console.warn(`  ⚠️  ${key} not set, skipping ${target}`);
        }
        return;
    }
    _assertPublishable(value, target);
    lines.push(`${target}=${value}`);
});

derivedEnv.forEach(({ target, value }) => {
    if (value === null) return; // intentionally not published
    _assertPublishable(value, target);
    lines.push(`${target}=${value}`);
});

fs.writeFileSync(targetEnvPath, `${lines.join('\n')}\n`);
console.log(`  ✅ wrote ${path.relative(projectRoot, targetEnvPath)} (${lines.length} vars)`);

if (fs.existsSync(staleEnvPath)) {
    fs.rmSync(staleEnvPath);
    console.log('  ✅ removed stale dashboard/.env (Next.js prefers .env.local)');
}

if (missingRequired.length) {
    console.error(
        `\n❌ Missing required deployment addresses: ${missingRequired.join(', ')}\n` +
            `   Wrote what was available, but the dashboard will not work until these are set.`
    );
    process.exitCode = 1;
}

// 2. Token config ----------------------------------------------------------------

console.log('\n🔄 Syncing token config...');
copyFile(
    path.join(projectRoot, 'supported_tokens.json'),
    path.join(projectRoot, 'dashboard/src/config/supported_tokens.json')
);

// 3. ABIs ------------------------------------------------------------------------

console.log('\n🔄 Syncing ABIs (abi only, not full artifacts)...');

const abis = [
    // V1
    'Market',
    'Positions',
    'PriceFeedL1',
    'LiquidityPoolFactory',
    'LiquidityPool',
    'ERC20',
    'UniswapV3Helper',
    'FeeManager',
    // V4
    'EswapRouter',
    'EswapRouterExt',
    'EswapMarginHook',
    'EswapMarginHookLogic2',
    'PriceFeed',
    'UsdcTwapFeed',
    'EthTwapFeed',
    'EswapLeverageAdapter',
    'EswapLeverageQuoter',
    'EswapSettlement',
    'EswapCoWSettlement',
    'EswapTimelock',
    'EswapLiquidationKeeper',
];

/** Resolve an artifact path, tolerating contracts compiled into a different dir. */
function resolveArtifact(name) {
    const direct = path.join(projectRoot, 'out', `${name}.sol`, `${name}.json`);
    if (fs.existsSync(direct)) return direct;

    const outDir = path.join(projectRoot, 'out');
    if (!fs.existsSync(outDir)) return null;

    for (const dir of fs.readdirSync(outDir)) {
        const candidate = path.join(outDir, dir, `${name}.json`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

const missingAbis = [];
abis.forEach((name) => {
    const src = resolveArtifact(name);
    if (!src) {
        missingAbis.push(name);
        return;
    }
    const artifact = JSON.parse(fs.readFileSync(src, 'utf8'));
    if (!artifact.abi) {
        missingAbis.push(name);
        return;
    }
    const dest = path.join(projectRoot, 'dashboard/src/abis', `${name}.json`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Keep the `{ abi: [...] }` shape: the dashboard imports these with
    // `import X from '../abis/X.json'` and then reads `X.abi` (ethers style),
    // so writing a bare array would break every call site. Only the ABI is kept.
    fs.writeFileSync(dest, JSON.stringify({ abi: artifact.abi }, null, 2));
    const kb = (fs.statSync(dest).size / 1024).toFixed(1);
    console.log(`  ✅ ${name} (${kb} KB)`);
});

if (missingAbis.length) {
    console.warn(`  ⚠️  no artifact found for: ${missingAbis.join(', ')}`);
    console.warn('     Run `forge build --via-ir` (after `node scripts/patch-v4-core.cjs`) first.');
    process.exitCode = 1;
}

console.log(process.exitCode ? '\n✨ Done with warnings (see above).' : '\n✨ Dashboard update complete!');
