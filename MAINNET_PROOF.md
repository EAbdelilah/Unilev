# Eswap v4 — Base Mainnet Live Proof (Broadcasted)

**Claim under test:** the Eswap moat — connecting **real aggregators** and
**real solvers** — works end-to-end on Base Mainnet with real signed
transactions, and the protocol holds none of its own capital.

**Status:** **PROVEN LIVE.** The full cycle (deploy → open → close) was
broadcast and confirmed on Base Mainnet (chain `8453`) on 2026-10-22. This is a
real on-chain proof, not a fork simulation. The venue that routed the swap is
the live **EnsoRouter V2**; the borrow leg was funded by a **registered solver**;
the notional is deliberately tiny (sub-cent-ish) to keep the broadcast cheap,
since the objective is to prove the *connection*, not size.

---

## 1. Live artifact summary

| Field | Value |
|---|---|
| Chain | Base Mainnet (`8453`) |
| Adapter (freshly deployed & wired to current router) | `0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD` |
| Router | `0xD3360D67E366Cac21a1c18fC9100B93be79e1437` |
| Hook (accounting) | `0xe33A630503c640143126BBF222a82689D49b50c8` |
| Hook pool id | `0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512` |
| Aggregator venue (real) | EnsoRouter V2 `0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf` |
| Solver (registered) | `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037` |
| Owner / broadcaster | `0x518634753C61342298c3E04326056b3Ce596a566` |
| Trader / recipient | `0x9F3CA377F06c709080b4c11c73832FD16a74c48a` |
| Margin / leverage / borrow | `20000` USDC (0.02) / `2x` / `20000` USDC |
| Notional | `40000` USDC (0.04) |

---

## 2. Broadcasted transactions (Basescan)

| Step | Tx hash | Block | Gas |
|---|---|---|---|
| Deploy `EswapLeverageAdapter(router)` | `0x947cf64de2b6c337a13a8ebb47dda62762b120c9bf8afc68948e061e0c713013` | 52956771 | 1,652,450 |
| `router.setExecutorWhitelist(adapter,true)` | `0xe5c31ae540ae038d5c151884ee93e22f47c8c9e79773698a01ecd33a95ec5810` | — | 46,721 |
| `adapter.registerPool(USDC,WETH,3000,hookKey,stdKey)` | `0x0d13b7131ebca58a4cf9e04305bcf2b3b46e1f2a4e200fb10df303d35019220c` | — | 143,298 |
| `adapter.setDefaultSolver(solver)` | `0x637edf352eb1b69facedafff9a12d6bb2c672d470fe23f88cadcdd6cdb3be00b` | — | 47,192 |
| Fund recipient USDC + gas ETH, approve router | `0x0abd64b7…`, `0x85d9e4ce…`, `0xf09aca87…` | — | — |
| **OPEN** `adapter.exactInputSingleWithLeverageAggregator` | `0xcc9b42f881a1e1e812ccf01f94bd4697f7b51baa25455b9ddddc1a0a10ad2281` | 52956808 | 1,493,057 |
| **CLOSE** `router.closePosition` | `0xfffc079b868e9f0bff30db98cd5a87efc95049cd0eee5a0323e6e9ed0cbdd328` | 52956842 | 418,440 |

Basescan links:

- Adapter deploy: https://basescan.org/tx/0x947cf64de2b6c337a13a8ebb47dda62762b120c9bf8afc68948e061e0c713013
- OPEN: https://basescan.org/tx/0xcc9b42f881a1e1e812ccf01f94bd4697f7b51baa25455b9ddddc1a0a10ad2281
- CLOSE: https://basescan.org/tx/0xfffc079b868e9f0bff30db98cd5a87efc95049cd0eee5a0323e6e9ed0cbdd328
- Adapter: https://basescan.org/address/0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD
- Aggregator (EnsoRouter V2): https://basescan.org/address/0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf

---

## 3. What actually happened (flow)

```
owner  -> deploy EswapLeverageAdapter(router=0xD336...)
owner  -> router.setExecutorWhitelist(adapter, true)
owner  -> adapter.registerPool(USDC, WETH, 3000, hookKey, standardKey)
owner  -> adapter.setDefaultSolver(0x3fc8...)
trader -> adapter.exactInputSingleWithLeverageAggregator
            -> EswapRouter.swapMultiPoolForAggregator
            -> EnsoRouter V2 .call(real Enso bundle calldata)   [REAL aggregator]
            -> EswapMarginHook accounting: position + solverDebt
trader -> EswapRouter.closePosition
            -> hook unwind -> solver repaid principal; trader gets residual
```

- The **borrowed leg was supplied by the solver**, not by protocol capital.
- The **swap was executed by the real EnsoRouter V2** using a live bundle
  fetched at execution time (not a fixture).
- The protocol **holds no USDC/WETH of its own** in the flow.

---

## 4. On-chain verification (read back from the chain)

**OPEN (`0xcc9b42f881…`)**
- `positions(hookPoolId, trader)`: trader `0x9F3CA377…`, collateral
  `16838960663405` wei WETH, borrowed `20000`, leverage `2`, isLong `true`.
- `solverDebts(hookPoolId, trader, solver)`: solver `0x3fc8…`, principal `20000`.
- `positionSolver(hookPoolId, trader)` = `0x3fc8…`.
- Recipient balance before open: `2000` USDC (leftover) → after: position opened.

**CLOSE (`0xfffc079b86…`)**
- `positions(...).trader` after = `0x0000000000000000000000000000000000000000` (cleared).
- `collateral` after = `0`.
- Solver USDC delta = **+20000** (principal repaid exactly).
- Trader USDC delta = **+20017** (residual returned).

**Protocol fees (accrued on open, unchanged by close):**
- `hook.protocolFees(WETH)` = `8423692177` wei.
- `hook.protocolFeeFor(trader)` = `5` bps.
- `hook.owner()` = `hook.treasury()` = `0x518634753C61342298c3E04326056b3Ce596a566`.

---

## 5. Real vs simulated

| Component | Status |
|---|---|
| Chain / block production | **REAL** — Base Mainnet |
| Transactions | **REAL** — broadcasted & mined (see hashes) |
| Aggregator (EnsoRouter V2) | **REAL** — live contract, live route |
| Route calldata | **REAL** — fetched from Enso API at execution time |
| V4 `PoolManager` | **REAL** — canonical Base PM |
| Eswap adapter / router / hook | **REAL** — live deployed bytecode |
| Solver | **REAL** — registered via `router.setSolverWhitelist` |
| Notional size | small by design (0.04 USDC) — proves flow, not size |
| Keeper / liquidation | not exercised in this proof |

---

## 6. Reproduce

```bash
# 0. build artifacts (adapter used by the script)
node scripts/patch-v4-core.cjs
forge build --via-ir

# 1. simulate only (no broadcast)
node scripts/v4/live-base-adapter-open.cjs

# 2. deploy adapter + setup + real aggregator+solver open (broadcast)
BROADCAST=1 ADAPTER_MARGIN=20000 ADAPTER_LEVERAGE=2 \
  node scripts/v4/live-base-adapter-open.cjs
#   -> writes adapter-open.json

# 3. close the position (broadcast)
BROADCAST=1 node scripts/v4/live-base-adapter-close.cjs
#   -> writes adapter-close.json
```

Artifacts: `adapter-open.json`, `adapter-close.json`.

---

## 7. Settlement binding reconciliation (2026-10-22)

The `router` in `EswapSettlement` / `EswapCoWSettlement` is an **immutable** set
in the constructor. The previous live settlers were permanently bound to the
retired router `0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1`, so they could not
be repointed. They were redeployed against the current router with
`scripts/v4/DeploySettlements.s.sol` (`--broadcast`, Base, tx
`broadcast/DeploySettlements.s.sol/8453/run-latest.json`):

| Contract | New address | router() verified | Notes |
|---|---|---|---|
| `EswapCoWSettlement` | `0xA9b26F6884526E822190204fe7279ee1db34Abd6` | `0xD3360D67…` | `gpv2Settlement` = canonical CoW `0x9008D19f…` |
| `EswapSettlement` (ERC-7683) | `0xb436226f1179c9A1cd7Ab16B1a1BFDAeC1FFFf86` | `0xD3360D67…` | solver-whitelisted on the router |

`.env` updated (`V4_COW_SETTLEMENT_ADDRESS`, `V4_SETTLEMENT_ADDRESS`) and
dashboard synced via `node javascript/update-dashboard.js`.

UniswapX / 1inch Fusion settlements were also redeployed against live venues
with `scripts/v4/DeployInventorySettlers.s.sol` (`--broadcast`, Base, tx
`broadcast/DeployInventorySettlers.s.sol/8453/run-latest.json`). Both are
**inventory-based** plain-swap fill sources (they do NOT open positions):

| Contract | New address | Immutable binding | Inventory |
|---|---|---|---|
| `EswapUniswapXSettlement` | `0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33` | reactor `0x000000001Ec5656d…` | in USDC / out WETH |
| `EswapOneInchFusionSettlement` | `0xD0F10948E5E987d9A04aDf4014178D65042f672c` | LOP `0x111111125421…` | maker USDC / taker WETH |

Both: `maxFillAmount = 5_000e6`, `operator = solver 0x3fc88b83…F037`, owner =
deployer `0x5186…a566`, and solver-whitelisted on the router. Deploy txs:
`0x4ec5fdde1f12151bec5f3f945a2677a03229e556659945c1ac296c03bc515862` (UX),
`0x1c1178344cc2f2c0ddc689a07970d3fd3503312cb58de10a37f57bd72e3f4974` (Fusion).
`.env` updated with both addresses and the full intent-settlement param set;
dashboard synced.

The pre-existing live contracts `0xE8A0EC44818395d5DE7c11df672B409539978Aa7`
(reactor `0x000000008a8330B5d1F43A62Bf4C673A49f27ba0`) and
`0x2797C7850e8724B9b7222DDddD42aEFc27c9F20A` (LOP
`0x111111125421cA6dc452d289314280a0f8842A65`) are now superseded and unbound
from `.env`.

---

## 8. Quoter redeploy (2026-10-22)

`V4_QUOTER_ADDRESS 0x3177f4e53a0EE0318174771b32E68aDe63c20f3b` had **no code**
on Base. The quoter was redeployed against the current router and the WETH/USDC
route registered, via
`forge script scripts/v4/DeployQuoter.s.sol:DeployQuoter --broadcast`
(broadcast `broadcast/DeployQuoter.s.sol/8453/run-latest.json`):

| Contract | New address | Verification |
|---|---|---|
| `EswapLeverageQuoter` | `0x36Fb18aFA12AeeB439157699dB478FD60Ffb842E` | `router()`=`0xD3360D67…`, `owner()`=`0x5186…a566` |
| deploy (CREATE) | tx `0xad077af92817a39c727781709e1a085c42fb16f7f1276c2e30d3b2ad6520f93f` | gas 970,140 |
| `registerPool` (CALL) | tx `0x08d41af3580dfa71ea89e5693ac47239a10abc2bb95728f6331ae7df9c5297c0` | hook key `[WETH,USDC,3000,60,hook]`, std key `[WETH,USDC,500,10,0x0]` |

The registered hook pool key hashes to the live `hookPoolId
0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512`. Live quote
sanity check (`quoteExactInputSingleWithLeverage(USDC,WETH,3000,…)`): 1000 USDC →
~0.4154 WETH at leverage 1, ~2.0769 WETH at leverage 5. `.env` updated
(`V4_QUOTER_ADDRESS`) and dashboard synced.

---

## 9. Notes / caveats

- The old adapter `0xC5616D22892828a500b5957efA9e5CcCD59d5C70` and quoter
  `0x3177f4e53a0EE0318174771b32E68aDe63c20f3b` had **no code**; `.env` now points
  at the redeployed `0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD` and
  `0x36Fb18aFA12AeeB439157699dB478FD60Ffb842E`.
- Public RPC (`https://mainnet.base.org`) served stale state right after the
  adapter deploy (a `0x` read). Reads/throttled sequential calls are used
  throughout; no dedicated `BASE_RPC_URL` is configured.
- Odos was not exercised (upstream down).
