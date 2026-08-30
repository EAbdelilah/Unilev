# Eswap Margin — Operational Runbook

## 1. Architecture Overview

```
┌──────────┐     ┌──────────────┐     ┌───────────────┐
│  Keeper   │────▶│  RPC Nodes   │────▶│  Smart        │
│ (Node.js) │     │ (failover)   │     │  Contracts    │
└──────────┘     └──────────────┘     └───────┬───────┘
       │                                       │
       ▼                                       ▼
┌──────────┐                          ┌───────────────┐
│ Health   │                          │  Blockchain   │
│ Server   │                          │  (Polygon /   │
│ :9090    │                          │   Unichain)   │
└──────────┘                          └───────────────┘
```

**Components:**
- **V3 Keeper** (`javascript/liquidate.js`): Monitors V3 Market contract for liquidatable positions
- **V4 Keeper** (`javascript/liquidation-keeper.js`): Monitors V4 Hook contract via event listening
- **Health Server** (built into both keepers): Exposes `/health` and `/metrics` HTTP endpoints
- **Logger** (`javascript/logger.js`): Structured pino logging with pino-pretty transport

## 1.1 Current Live Deployment — Unichain Mainnet (chain 130)

> Updated after REDEPLOY-3 (oracle-anchored circuit breaker). Verify with
> `cast code <addr>` / `node javascript/network-info.js`.

| Contract            | Address                                      |
| ------------------- | --------------------------------------------- |
| EswapMarginHook     | `0xe3574Bc94557378fD944cdF1EE2F56f7c12d90c8` |
| EswapRouter         | `0x1244a9977368A09aA38619D92959A78638Ac0DEa` |
| EswapLiquidationKeeper | `0xB43D0A603D9Bf6Bd9463709eDbDDF9B6ee2D484d` |
| PriceFeed           | `0x798518400Ae9C6A145dA2A646833627ef6c2c510` |
| PoolManager (canonical) | `0x1F98400000000000000000000000000000000004` |

**Fill venue (standardPoolKey) for USDC/WETH = fee-500 no-hook pool**
(`0x078D…6 / 0x4200…06`, fee 500, ts 60, hooks 0x0). Chosen because the canonical
fee-500 pool carries ~2e11 liquidity (~$2030/WETH), while the fee-3000 no-hook
pool is only ~1.8e7 — 11,000× thinner and produces ~99% fill slippage.

**Why oracle-anchored breaker (REDEPLOY-3):** `_checkV4SpotAgainstV3Twap` derives
the "honest spot `sqrtPriceX96`" from the LIVE Chainlink oracle pair price
(`getTwapPrice(currency0/currency1)`), inverting `checkTwap`'s token-decimal
adjustment. Because the whole accounting/liquidation path is already oracle-
anchored via `getAmountInUsd`, the AMM pool spot is not a trusted input — so the
guard makes spot == twap == oracle and never false-positives at ANY price/pair
(WETH or WBTC), while still reverting `TwapNotConfigured` when a feed is missing
under `requireTwapOracle`. This is what unblocks honest live fills.

**Live smoke validation (this deployment):** opened a USDC-margin LONG via
`swapMultiPool` on the fee-500 venue (no `TwapManipulated`), rehypothecated LP
deployed (pos.liquidity > 0), then closed — full open→close round-trip mined,
collateral returned, position cleared. Scripts: `scripts/v4/{DeploySwapper,
FundDeployer2,RepointAndOpen,CloseLivePosition}.s.sol`.

> NOTE: deployer EOA (`0x5186…566`) holds ~$0.5 USDC. Unichain V4 USDC/WETH pools
> are thinly capitalized, so realistic-size fills experience material slippage
> (venue depth, not a contract defect).

## 2. Keeper Deployment

### Prerequisites
```bash
node >= 18.x
npm install   # installs ethers, pino, pino-pretty, dotenv
```

### Environment Variables
Both keepers read from the root `.env` file:

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | Yes | Primary RPC endpoint |
| `RPC_URL_2`–`RPC_URL_5` | No | Fallback RPC endpoints |
| `PRIVATE_KEY` | Yes | Keeper wallet private key (must hold MATIC/ETH for gas) |
| `MARKET_ADDRESS` | V3 only | V3 Market contract address |
| `V4_HOOK_ADDRESS` | V4 only | V4 EswapMarginHook address |
| `V4_ROUTER_ADDRESS` | V4 only | V4 EswapRouter address |
| `V4_POOL_MANAGER_ADDRESS` | V4 only | Uniswap V4 PoolManager address |
| `CHECK_INTERVAL` | No | Poll interval in ms (default: 15000) |
| `MAX_POSITIONS_PER_TX` | No | Max positions per liquidation tx (default: 10 V3 / 5 V4) |
| `CONFIRMATION_BLOCKS` | No | Blocks to wait for confirmation (default: 2) |
| `LOG_LEVEL` | No | pino log level (default: info) |
| `HEALTH_PORT` | No | Health server port (default: 9090) |

### Running
```bash
# V3 keeper
node javascript/liquidate.js

# V4 keeper
node javascript/liquidation-keeper.js

# Run as background process (Linux/macOS)
nohup node javascript/liquidate.js > keepers/liquidate.log 2>&1 &

# Run as Windows service (PowerShell)
Start-Process -NoNewWindow -RedirectStandardOutput "keepers/liquidate.log" node "javascript/liquidate.js"
```

### systemd Unit (Linux)
```ini
[Unit]
Description=Eswap V3 Liquidation Keeper
After=network.target

[Service]
Type=simple
User=eswap
WorkingDirectory=/opt/eswap
ExecStart=/usr/bin/node /opt/eswap/javascript/liquidate.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## 3. Monitoring

### Health Endpoint
```
GET http://<keeper-host>:9090/health
→ {"status":"ok","uptime":"3600s","timestamp":"2026-07-30T12:00:00.000Z"}
```

### Prometheus Metrics
```
GET http://<keeper-host>:9090/metrics
→ # HELP eswap_keeper_...
   # TYPE eswap_keeper_... gauge/counter
   eswap_keeper_positions_tracked 42
   eswap_keeper_liquidations_total 150
   eswap_keeper_liquidations_succeeded 148
   eswap_keeper_liquidations_failed 2
   eswap_keeper_errors_total 5
   eswap_keeper_rpc_failovers 3
   eswap_keeper_nonce_conflicts 0
   eswap_keeper_last_liquidation_timestamp 1722345600
   eswap_keeper_uptime_seconds 86400
```

### Alerting Thresholds (recommended)

| Metric | Warning | Critical | Action |
|--------|---------|----------|--------|
| `liquidations_failed` rate > 1/min | Check RPC health | Investigate contract state | See §4.2 |
| `rpc_failovers` rate > 5/min | RPC endpoint degrading | Add/replace RPC URLs | Update `.env`, restart keeper |
| `errors_total` rate > 3/min | Non-critical errors | Potential bug | Check logs |
| `last_liquidation_timestamp` > 1h | No liquidatable positions (normal on quiet markets) | Keeper may be stuck | Check `/health` |
| `positions_tracked` drops to 0 | Event scanning issue (V4) or all positions cleared | Investigate | Check contract state |

### Logs
```bash
# Structured JSON logs (production)
tail -f keepers/liquidate.log | pino-pretty

# Filter for errors
tail -f keepers/liquidate.log | jq 'select(.level >= 50)'
```

## 4. Emergency Response

### 4.1 Pause Protocol
If a critical vulnerability is discovered:

1. **Pause Market** (V3):
   ```solidity
   // Call via admin wallet
   Market.pause()
   ```
2. **Pause Hook** (V4):
   ```solidity
   // Call via admin wallet
   EswapMarginHook.setPaused(true)
   ```
3. **Pause FeeManager**:
   ```solidity
   FeeManager.pause()
   ```

   Pausing prevents: new positions, liquidations, settlements.
   Unpause only after fix is deployed and tested.

### 4.2 Keeper Stuck / Failing
```bash
# 1. Check health
curl http://localhost:9090/health

# 2. Check latest logs
tail -50 keepers/liquidate.log

# 3. Restart keeper
kill <PID> && node javascript/liquidate.js

# 4. If nonce is stuck, reset nonce manager
#    → NonceManager auto-resets on conflict detection
#    → For persistent issues, wait for pending tx to clear, then restart
```

### 4.3 RPC Node Failure
```bash
# 1. Verify RPC URLs in .env
grep RPC_URL .env

# 2. Add/replace endpoints
RPC_URL_2=https://polygon-rpc.com
RPC_URL_3=https://rpc.ankr.com/polygon

# 3. Restart keeper — FailoverProvider will cycle to healthy node automatically
```

### 4.4 Private Key Compromise
```bash
# 1. Transfer remaining gas funds to new wallet
#    (use a temporary script or send raw tx)

# 2. Update .env with new PRIVATE_KEY

# 3. Restart keeper

# 4. If contract has ownership controls that used old key:
#    Transfer ownership to new admin address (requires old key)
```

### 4.5 Contract Upgrade / Migration
```bash
# 1. Deploy new contracts (see Makefile)
make deploy-polygon

# 2. Update .env with new contract addresses
MARKET_ADDRESS=<new-address>

# 3. Sync dashboard
node javascript/update-dashboard.js

# 4. Restart keeper
```

## 5. Restart / Rollback Procedures

### 5.1 Clean Restart (no state migration)
```bash
# Stop keeper
kill <PID>   # or systemctl stop eswap-keeper

# Verify it stopped
ps aux | grep liquidate

# Start again
node javascript/liquidate.js
```

### 5.2 Full Rollback (contract redeploy)
```bash
# 1. Pull previous contract version
git checkout <previous-tag>
make build

# 2. Deploy previous version
make deploy-polygon   # or deploy-unichain

# 3. Migrate state if needed (positions, pools)
#    This requires custom migration scripts — see EswapMigrationTest.t.sol

# 4. Update addresses in .env
node javascript/update-env.js
node javascript/update-dashboard.js

# 5. Restart keeper
```

### 5.3 Database / State Recovery
Eswap contracts store all state on-chain. No off-chain database exists.
- **Recovery = replay events from block N** (V4 keeper does this on startup via `scanExistingPositions`)
- V3 keeper re-checks `getLiquidablePositions()` each cycle; no event state to recover

## 6. Incident Response Flow

```
1. DETECT
   │
   ├── Alert fires (Prometheus / monitoring)
   ├── User reports issue
   └── Logs show errors
       │
       ▼
2. TRIAGE
   │
   ├── Check /health endpoint
   ├── Check recent logs
   ├── Check contract state (via Polygonscan / ethers script)
   └── Check RPC status
       │
       ▼
3. DECIDE
   │
   ├── Minor (RPC failover, nonce reset) → restart keeper
   ├── Moderate (contract bug, price feed stale)
   │   ├── Pause protocol (§4.1)
   │   └── Deploy fix
   └── Critical (funds at risk)
       ├── Pause protocol immediately
       ├── Lock liquidity pools
       ├── Contact security team
       └── Prepare post-mortem
       │
       ▼
4. RESOLVE
   │
   ├── Deploy fix / rollback
   ├── Unpause protocol
   ├── Monitor for settling
   └── Write post-mortem
```

## 7. Key Contacts & Tools

| Resource | Details |
|----------|---------|
| Contract Deployment | `make deploy-polygon`, `make deploy-unichain` |
| Dashboard Sync | `node javascript/update-dashboard.js` |
| Health Check | `http://<keeper>:9090/health` |
| Prometheus Metrics | `http://<keeper>:9090/metrics` |
| Logs | `keepers/liquidate.log` (V3), `keepers/liquidation-keeper.log` (V4) |
| Contracts Source | `src/`, `src/v4/` |
| Test Suite | `make test`, `make test-ci` |

## 8. Maintenance Windows

No protocol downtime is required for:
- **Adding RPC endpoints**: Update `.env`, restart keeper
- **Deploying new trading pairs**: Through factory contracts (no pause needed)
- **Updating keeper code**: `git pull && npm install && restart`

Protocol pause IS required for:
- **Upgrading core contracts** (Market, Hook, FeeManager)
- **Migrating liquidity pools** to new token addresses
- **Emergency vulnerability fixes**

## 9. Appendix: Quick Reference

```bash
# Restart V3 keeper
kill $(pgrep -f "node javascript/liquidate.js"); nohup node javascript/liquidate.js > keepers/liquidate.log 2>&1 &

# Restart V4 keeper
kill $(pgrep -f "node javascript/liquidation-keeper.js"); nohup node javascript/liquidation-keeper.js > keepers/liquidation-keeper.log 2>&1 &

# Check keeper is running
ps aux | grep node | grep -E "liquidate|keeper"

# Tail logs in human-readable format
tail -f keepers/liquidate.log | npx pino-pretty

# Force-kill if stuck
kill -9 $(pgrep -f "node javascript/liquidate.js")
```
