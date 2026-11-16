# Eswap Margin Protocol on Base — CoW Swap Partner / Solver Submission (Dossier)

## 1) Title & Summary
**Title:** Eswap Margin Protocol on Base (Chain ID 8453) — 0% borrower interest, permissionless solver settlement via canonical GPv2 orders.

**Summary:** Eswap is a Uniswap v4 margin layer on **Base (8453)** that enables leveraged long/short positions with **0% borrower interest**. Solvers provide the borrow leg from their own capital (escrowed on-chain via `EswapRouter`) and are repaid from position settlement flows. **All three major solver rails are permissionless and solver-capitalized:** CoW Protocol (`EswapCoWSettlement`), 1inch Fusion (`EswapOneInchFusionSettlement`), and UniswapX (`EswapUniswapXSettlement`) allow external solvers/fillers to bond borrow in escrow and open leveraged positions credited to traders (with the filler recorded as `positionSolver`). This keeps protocol balance-sheet borrow exposure at **zero**.

- Chain: **Base Mainnet, chainId 8453**
- Core idea: **solver-funded leverage + CoW-compatible order settlement + permissionless intent feed**
- Repo docs: `docs/SOLVER_INTEGRATION_GUIDE.md`, `docs/INTENT_RELAY_DEPLOY.md`, `MAINNET_PROOF.md`

---

## 2) Verified Base Mainnet Addresses (Sourcify `exact_match` links)

| # | Contract | Address (Base 8453) | Sourcify (exact_match) |
|---|---|---|---|
| 1 | EswapRouter | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` | https://repo.sourcify.dev/contracts/full_match/8453/0x5b226aE5158de86f1E616875dBab886870B9aAd9/ |
| 2 | EswapMarginHook | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` | https://repo.sourcify.dev/contracts/full_match/8453/0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8/ |
| 3 | EswapCoWSettlement | `0x7341859C0D7e039118b3f85F341583EBCDB8c960` | https://repo.sourcify.dev/contracts/full_match/8453/0x7341859C0D7e039118b3f85F341583EBCDB8c960/ |
| 4 | EswapSettlement (ERC-7683/generic) | `0x6F347acB3bD901731e192d482b7a40c50f30FCa1` | https://repo.sourcify.dev/contracts/full_match/8453/0x6F347acB3bD901731e192d482b7a40c50f30FCa1/ |
| 5 | EswapUniswapXSettlement | `0x8cB966a5102444BbeD5A222AcE1b88d0421b0cB2` | https://repo.sourcify.dev/contracts/full_match/8453/0x8cB966a5102444BbeD5A222AcE1b88d0421b0cB2/ |
| 6 | EswapOneInchFusionSettlement | `0x587f01dE3c42eB5E6a9DBA7a3026719F6F95FBbb` | https://repo.sourcify.dev/contracts/full_match/8453/0x587f01dE3c42eB5E6a9DBA7a3026719F6F95FBbb/ |
| 7 | EswapLeverageAdapter | `0xC622558e9145dbe0Bc37Db5311e70f3F9Fa8cc48` | https://repo.sourcify.dev/contracts/full_match/8453/0xC622558e9145dbe0Bc37Db5311e70f3F9Fa8cc48/ |
| 8 | EswapLeverageQuoter | `0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5` | https://repo.sourcify.dev/contracts/full_match/8453/0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5/ |
| 9 | PriceFeed | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` | https://repo.sourcify.dev/contracts/full_match/8453/0x91d75C7f750510C04516fC4dcEB5737E5B170c02/ |
| 10 | Uniswap V4 PoolManager (canonical Base) | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | https://repo.sourcify.dev/contracts/full_match/8453/0x498581fF718922c3f8e6A244956aF099B2652b2b/ |
| 11 | CoW GPv2Settlement (canonical) | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | https://repo.sourcify.dev/contracts/full_match/8453/0x9008D19f58AAbD9eD0D60971565AA8510560ab41/ |
| 12 | WETH (Base) | `0x4200000000000000000000000000000000000006` | https://repo.sourcify.dev/contracts/full_match/8453/0x4200000000000000000000000000000000000006/ |
| 13 | USDC (Base, native) | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | https://repo.sourcify.dev/contracts/full_match/8453/0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913/ |
| 14 | EswapMarginHookLogic | `0x9af81574df72A128efAF6096878e17d733443e54` | https://repo.sourcify.dev/contracts/full_match/8453/0x9af81574df72A128efAF6096878e17d733443e54/ |
| 15 | EswapMarginHookLogic2 | `0x8881FC6FD44bAD9d26b78F5310083dd5f9c946DD` | https://repo.sourcify.dev/contracts/full_match/8453/0x8881FC6FD44bAD9d26b78F5310083dd5f9c946DD/ |
| 16 | EswapMarginHookLogic3 | `0x1Fa03fD4f6B8ff082C110438c57b59f6AB4685cF` | https://repo.sourcify.dev/contracts/full_match/8453/0x1Fa03fD4f6B8ff082C110438c57b59f6AB4685cF/ |
| 17 | EswapMarginHookLogic4 | `0xCbC4800887503534CC9934a9241D3D7963fA384C` | https://repo.sourcify.dev/contracts/full_match/8453/0xCbC4800887503534CC9934a9241D3D7963fA384C/ |
| 18 | EswapPositionMathLib | `0xeDb32ad2A85C96E2D975C444161510776626fBE9` | https://repo.sourcify.dev/contracts/full_match/8453/0xeDb32ad2A85C96E2D975C444161510776626fBE9/ |

---

## 3) Solver Incentive Breakdown

- **100% Uniswap v4 rehypothecated LP swap fees routed to solver:** In the hook settlement flow, any realized LP yield from the rehypothecated band is distributed to the recorded position solver (per Eswap hook logic), aligning solver PnL with execution/LP-fee contribution during the position lifecycle.
- **Senior claim on collateral repayment:** Solver principal is treated as senior in unwind/settlement accounting; proceeds repay the solver’s funded borrow principal (and related credited yield per contract rules) before returning residual value to the trader, subject to protocol constraints and available proceeds.
- **0 protocol balance-sheet dependency:** Borrow funding is supplied by solvers (via router escrow / solver-funded paths), not by protocol-owned treasury capital for the borrow leg. The protocol does not need to hold borrower liquidity on its balance sheet to enable these leveraged fills.
- **Explicit risk note (for transparency):** Solver capital is at risk if unwind proceeds are insufficient after senior waterfall and any configured backstops; solvers should underwrite exposure, slippage, and market conditions.

---

## 4) Order Commitment Spec (canonical `appDataJson(leverage)`)

For CoW-based fills through `EswapCoWSettlement`, the order’s `appData` must commit to leverage.

**Canonical JSON (byte-exact):**
```json
{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"<L>"}}
```

- `appData` hash used in the GPv2 order is `keccak256(bytes(appDataJson(L)))`.
- The document should be registered with the CoW orderbook/app-data service before order submission.
- `EswapCoWSettlement` enforces: `order.appData == keccak256(bytes(appDataJson(params.leverage)))`. Mismatch reverts (leverage commitment mismatch).
- Supported leverage values are constrained by protocol configuration (commonly 2–5x in current docs/tests); solvers must read on-chain/published params before bidding.

**How external solvers call `fillOrder(...)` (high level):**
1. Discover an open intent/order (see intent feed below) that includes a valid GPv2 order + signature (+ scheme).
2. Verify order integrity off-chain (`verify`) and confirm owner allowances/liquidity assumptions.
3. Ensure solver has funded borrow escrow for the required borrow token/amount via `EswapRouter.depositBorrowEscrow(...)` (permissionless bonding model).
4. Call `EswapCoWSettlement.fillOrder(order, scheme, signature, fillParams)` where `fillParams.solver == msg.sender` and includes leverage + pool keys consistent with the intent.
5. Submit fill tx; on success the settlement marks the order filled and routes into Eswap margin opening flow per contract logic.

---

## 5) Intent Feed Endpoint (solver integration)

Eswap exposes a permissionless intent feed (no funds held by relay) so solvers can discover open margin intents.

### Production/hosted feed (Next.js App Router)
When the dashboard is deployed, endpoints are available at:
- `GET /api/health` — liveness/chain check
- `GET /api/intents?status=open` — list open, unexpired, unfilled intents
- `GET /api/intents/:id` — fetch one intent by on-chain order UID
- `POST /api/intents` — submit `{order, scheme, signature}` (verified before listing)
- `POST /api/intents/:id/filled` — report fill `{txHash?}` (accepted only after on-chain filled state is observed)

### Local standalone relay (dev)
- Default: `http://127.0.0.1:8787`
- `GET /intents?status=open`
- `POST /intents`
- `GET /intents/:id`
- `POST /intents/:id/filled`

### Solver polling + reporting flow
- Poll `GET /api/intents?status=open` (or your hosted base URL + `/api/intents?status=open`).
- For each intent: validate signature/appData/leverage commitment, check solver escrow sufficiency, simulate `fillOrder`.
- After a successful on-chain fill, report to `POST /api/intents/:id/filled` with `{ "txHash": "0x..." }` (relay/verifier checks on-chain fill state).

Set:
```bash
INTENT_FEED_URL=https://<your-domain>/api/intents?status=open
```

---

## 6) Quickstart for Solvers (run `scripts/solvers/cowSolverBot.ts`)

From repo root:

```bash
# 1) Install deps (if not already)
npm install

# 2) Configure environment (example)
export BASE_RPC_URL="https://mainnet.base.org"
export SOLVER_PRIVATE_KEY="0x..."
export INTENT_FEED_URL="https://<your-domain>/api/intents?status=open"

# 3) Dry run against feed (no transactions)
node node_modules/tsx/dist/cli.mjs scripts/solvers/cowSolverBot.ts --dry-run

# 4) Optional: run against a local generated/demo intent flow (see script flags)
node node_modules/tsx/dist/cli.mjs scripts/solvers/cowSolverBot.ts --demo --dry-run
```

Notes:
- The bot verifies intents, checks leverage/appData commitment, checks escrow shortfalls, and only submits fills in live mode.
- Ensure you have bonded borrow capital via `EswapRouter.depositBorrowEscrow(...)` before live fills.
- For deployment/hosting of the intent feed, see `docs/INTENT_RELAY_DEPLOY.md`.
