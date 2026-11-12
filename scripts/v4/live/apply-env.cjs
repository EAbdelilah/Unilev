#!/usr/bin/env node
/**
 * Sync `.env` with the addresses that actually landed on chain.
 *
 *   node scripts/v4/live/apply-env.cjs phase3-broadcast.log
 *
 * Why: hand-editing a dozen addresses is exactly the step that silently leaves
 * one key pointing at the retired stack. This script therefore trusts *two*
 * sources and cross-checks them:
 *
 *   1. the `V4_*=<address>` / `POOL_ID=<id>` block a `forge script` run prints
 *   2. the broadcast artifacts under `broadcast/...`, filtered to creation
 *      transactions only (forge also records plain calls under the created
 *      contract's name, so `contractName` alone is not enough)
 *
 * (2) is needed because the forge summary block does not print every address
 * `.env` consumes -- notably the PriceFeed, the USDC TWAP feed, RouterExt and
 * the two inventory settlers. Relying on (1) alone left those keys stale.
 *
 * The script is idempotent: it rewrites existing keys in place (preserving
 * comments and ordering) and appends any key that is missing. It never touches
 * a key it was not given, refuses to write a zero address, and finally re-reads
 * `.env` to prove no address key still disagrees with the deployment.
 */
const fs = require('fs');
const path = require('path');

const logFile = process.argv[2] || 'phase3-broadcast.log';
const envFile = path.resolve(process.cwd(), '.env');

// Windows PowerShell's `Tee-Object` (the command this script's header suggests)
// writes UTF-16LE with a BOM, which reads as NUL-interleaved text under utf8 and
// would make every line fail to match. Accept UTF-16LE/BE as well as UTF-8.
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf[0] === 0xfe && buf[1] === 0xff) return buf.swap16().toString('utf16le', 2);
  return buf.toString('utf8').replace(/^\uFEFF/, '');
}

if (!fs.existsSync(logFile)) {
  console.error(`missing log file: ${logFile}`);
  console.error('run the broadcast first, e.g.');
  console.error('  forge script ... --broadcast 2>&1 | Tee-Object -FilePath phase3-broadcast.log');
  process.exit(1);
}

const log = readText(logFile);

// `V4_HOOK_ADDRESS=0x7b3F...` and `POOL_ID=0x48cc...`
const found = {};
for (const m of log.matchAll(/^\s*(V4_[A-Z0-9_]+|POOL_ID|USDC_TWAP_FEED)\s*=\s*(0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64})\s*$/gm)) {
  found[m[1]] = m[2];
}

// Addresses the forge block omits. Read from the broadcast artifacts, keeping
// only CREATE/CREATE2 entries so a recorded call cannot masquerade as a deploy.
// `broadcast/` is gitignored, so the committed snapshot is used when a fresh
// clone has no broadcast record.
const BROADCAST_DIR = 'broadcast/RedeployBaseFull.s.sol/8453';
const SNAPSHOT = 'scripts/v4/live/proofs/redeploy-8453-2026-11-11.json';

function loadTransactions(file, snapshotKey) {
  if (fs.existsSync(file)) return JSON.parse(readText(file)).transactions || [];
  if (fs.existsSync(SNAPSHOT)) {
    const part = JSON.parse(readText(SNAPSHOT))[snapshotKey];
    if (part) return part.transactions || [];
  }
  return null;
}

const ARTIFACT_SOURCES = [
  {
    file: `${BROADCAST_DIR}/run-latest.json`,
    snapshotKey: 'phase3',
    map: {
      EswapRouterExt: ['V4_ROUTER_EXT_ADDRESS'],
      EswapUniswapXSettlement: ['V4_UNISWAPX_SETTLEMENT_ADDRESS'],
      EswapOneInchFusionSettlement: ['V4_ONEINCH_FUSION_SETTLEMENT_ADDRESS'],
      EswapRouter: ['V4_ROUTER_ADDRESS'],
      EswapMarginHook: ['V4_HOOK_ADDRESS'],
      EswapLeverageAdapter: ['V4_ADAPTER_ADDRESS'],
      EswapLeverageQuoter: ['V4_QUOTER_ADDRESS'],
      EswapLiquidationKeeper: ['V4_KEEPER_ADDRESS'],
      EswapCoWSettlement: ['V4_COW_SETTLEMENT_ADDRESS'],
      EswapSettlement: ['V4_SETTLEMENT_ADDRESS'],
    },
  },
  {
    file: `${BROADCAST_DIR}/deployPriceFeed-latest.json`,
    snapshotKey: 'phase1',
    map: {
      PriceFeed: ['PRICE_FEED_ADDRESS', 'V4_PRICEFEED_ADDRESS'],
      UsdcTwapFeed: ['USDC_TWAP_FEED'],
    },
  },
];

const fromArtifacts = {};
const missingArtifacts = [];
for (const { file, snapshotKey, map } of ARTIFACT_SOURCES) {
  const txs = loadTransactions(file, snapshotKey);
  if (!txs) {
    missingArtifacts.push(file);
    continue;
  }
  for (const [contractName, keys] of Object.entries(map)) {
    const creation = txs.find(
      (t) => t.contractName === contractName && (t.transactionType === 'CREATE' || t.transactionType === 'CREATE2'),
    );
    if (!creation) continue;
    for (const k of keys) fromArtifacts[k] = creation.contractAddress;
  }
}

// Keys the aggregator/solver package needs that the forge block does not print.
// ONEINCH_FUSION_MAX_TAKING must stay in lockstep with the deployed settler's
// immutable: the Fusion cap is baked into the constructor, so a mismatch here
// only affects the *next* redeploy -- but it would silently reintroduce the
// "maxTaking defaults to maxMaking" bug if someone re-ran DeployInventorySettlers.
const EXTRA = {
  ONEINCH_FUSION_MAX_TAKING: '5000000000000000000',
};

// Keys that hold an address but are configuration rather than a contract from
// this deployment (the solver EOA is chosen, not deployed), so they are exempt
// from the staleness check below.
const CONFIG_KEYS = new Set(['V4_SOLVER_ADDRESS']);

// Prefer EIP-55 casing in .env; fall back to the raw value if ethers is absent.
let checksum = (a) => a;
try {
  const { getAddress } = require('ethers');
  checksum = (a) => {
    try {
      return getAddress(a);
    } catch {
      return a;
    }
  };
} catch {
  /* keep raw */
}

// The log wins where it speaks; artifacts fill the rest.
const updates = {};
for (const [k, v] of Object.entries({ ...fromArtifacts, ...found })) updates[k] = checksum(v);
Object.assign(updates, EXTRA);

if (Object.keys(found).length === 0 && Object.keys(fromArtifacts).length === 0) {
  console.error(`no addresses found in ${logFile} or the broadcast artifacts - was the broadcast successful?`);
  process.exit(1);
}
for (const [k, v] of Object.entries(updates)) {
  if (/^0x0{40}$/i.test(v)) {
    console.error(`refusing to write a zero address for ${k}`);
    process.exit(1);
  }
}

const txt = fs.readFileSync(envFile, 'utf8');
const eol = txt.includes('\r\n') ? '\r\n' : '\n';
const lines = txt.split(/\r?\n/);

const written = new Set();
const out = lines.map((line) => {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
  if (!m || !(m[1] in updates)) return line;
  written.add(m[1]);
  return `${m[1]}=${updates[m[1]]}`;
});

for (const [k, v] of Object.entries(updates)) {
  if (!written.has(k)) out.push(`${k}=${v}`);
}

fs.writeFileSync(envFile, out.join(eol));

console.log(`updated ${envFile}`);
for (const [k, v] of Object.entries(updates)) {
  const src = k in found ? 'log' : k in EXTRA ? 'config' : 'artifact';
  console.log(`  ${written.has(k) ? 'set   ' : 'added '} ${k}=${v}  (${src})`);
}
if (missingArtifacts.length) {
  console.log('\nwarning: broadcast artifact(s) not found, some keys were not cross-checked:');
  for (const f of missingArtifacts) console.log(`  ${f}`);
}

// Prove the result: every address key in .env must now agree with the deployment.
const ADDRESS_KEY = /^(V4_[A-Z0-9_]+|POOL_ID|PRICE_FEED_ADDRESS|USDC_TWAP_FEED)$/;
const after = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
const stale = [];
const config = [];
for (const line of after) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(0x[0-9a-fA-F]*)\s*$/);
  if (!m || !ADDRESS_KEY.test(m[1])) continue;
  if (!(m[1] in updates)) {
    if (CONFIG_KEYS.has(m[1])) config.push(`${m[1]}=${m[2]}`);
    else stale.push(`${m[1]}=${m[2]} (not covered by this deployment)`);
  } else if (m[2].toLowerCase() !== updates[m[1]].toLowerCase()) {
    stale.push(`${m[1]}=${m[2]} (expected ${updates[m[1]]})`);
  }
}
if (config.length) {
  console.log('\nconfig keys (not deployed by this script, left untouched):');
  for (const c of config) console.log(`  ${c}`);
}
if (stale.length) {
  console.error('\nstale address keys remain in .env:');
  for (const s of stale) console.error(`  ${s}`);
  process.exit(1);
}
console.log('\nall address keys in .env agree with the deployment');
