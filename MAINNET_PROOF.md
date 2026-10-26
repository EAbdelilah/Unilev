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

---

## 10. CoW Protocol GPv2 + direct solver intent (2026-10-25)

Two settlement paths that do **not** use an aggregator were broadcast on Base
Mainnet: a real CoW Protocol GPv2 order coerce-filled by a solver through
`EswapCoWSettlement.fillOrder`, and a trader-signed `LendingIntent` filled by a
permissionless solver through `EswapRouter.swapWithIntent`. Both open live
leveraged long positions (USDC margin -> WETH collateral) and both consume the
solver's `erc20BorrowEscrow` for the borrow leg.

### 10.1 CoW Protocol GPv2 settlement fill

| Field | Value |
|---|---|
| Call | `EswapCoWSettlement.fillOrder` (`0xA9b26F6884526E822190204fe7279ee1db34Abd6`) |
| Tx | `0xd2dab148d807b794ba2931853c18c803edb28fab1cfe8b13b2a225cdeac0f48f` |
| Block / gas | `53070361` / `1,104,893` (gasPrice `6,000,000` wei) |
| Escrow pre-fund | `depositBorrowEscrow(USDC, 7000)` tx `0xf0360c78b4cb4e594f9e2cec5b39dc507e86b4aeb59f6fc34efbc963e8958bc3` (block 53070359) |
| Order owner / receiver | `0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c` (receiver == swapper) |
| Solver | `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037` |
| Order UID | `0x89cbdce119419fc200193971e779d092cbb2a645eb27e4b9cf3465195e960f7dd9aba9723d14b36588bcf9d47c2ff355eec47f3c6addff1d` |
| GPv2 domain separator | `0xd72ffa789b6fae41254d0b5a13e6e1e92ed947ec6a251edf1cf0b6c02c257b4b` (binds canonical `0x9008D19f�ab41`) |
| sell / buy | USDC -> WETH, `kind="sell"`, `partiallyFillable=false`, `feeAmount=0` |
| appData | `0xe41487c9�291bfb` == `keccak256(appDataJson(2))` == `leverageCommitment(2)` |
| Margin / leverage / borrow | `7000` / `2x` / `7000` USDC-units (0.007 / 0.007) |
| Position after | collateral `5,986,499,540,201` wei WETH, borrowed `7000`, lev `2`, long |
| Replay lock | `filledOrders[keccak256(orderUid)] == true` |
| Escrow after | `0` (spent on this fill, not idle) |

The order is signed with the **canonical** CoW EIP-712 type: `kind`,
`sellTokenBalance` and `buyTokenBalance` are `string` in the signed data while
the on-chain struct slots carry `keccak256("sell")` / `keccak256("erc20")`. That
mismatch was the entire reason earlier attempts reverted; the settlement now
recovers the trader correctly (`verify()` cross-checked before broadcast).

### 10.2 Direct solver intent fill

| Field | Value |
|---|---|
| Call | `EswapRouter.swapWithIntent` (`0xD3360D67E366Cac21a1c18fC9100B93be79e1437`) |
| Tx | `0x180f452efa7ee76848dd20822ddd2c8887107356ebf3d08717ad4d66878fe7ed` |
| Block / gas | `53070519` / `983,606` (gasPrice `6,000,000` wei) |
| Escrow pre-fund | `depositBorrowEscrow(USDC, 4000)` tx `0x0cb56a3a6566dc136a93ac899628ab58862e35d5393f91704fb61158f57959df` (block 53070517) |
| Trader (intent signer) | `0x518634753C61342298c3E04326056b3Ce596a566` |
| Solver | `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037` (`registeredSolvers == true`, `solverNotionalCap == 0`) |
| Intent | `zeroForOne=false` (USDC->WETH), `leverage=2`, `minAmountOut=0`, `nonce=1`, deadline +1h |
| Fill id / nonce | `0x78371bf56a1f77744f708f95dadb442f049cb6e4c14cf059e84a7e834d0c14c7` / `1` |
| Margin / leverage / borrow | `4000` / `2x` / `4000` USDC-units (0.004 / 0.004) |
| Position after | collateral `3,420,895,939,262` wei WETH, borrowed `4000`, lev `2`, long |
| Replay lock | `filledIntents[keccak256(trader,nonce)] == true` |
| Escrow after | `0` (borrow leg drawn from escrow, then refilled per fill) |

Pool ids used: hook `0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512`
(`[WETH,USDC,3000,60,hook]`), deep-fill `0x90333bb05c258fe0dddb2840ef66f1a05165aa7dac6815d24e807cc6ebd943a0`
(`[WETH,USDC,500,10,0x0]`).

### 10.3 Size compliance (read this before quoting numbers)

The requested proof size was **5 USDC margin with a 10 USDC escrow**. That is
physically unbroadcastable with the current funded wallets:

| Wallet | USDC | ETH |
|---|---|---|
| owner / relayer `0x5186�a566` | `0.029644` | `0.000328` |
| solver `0x3fc8�F037` | `0.030000` | `0.000030` |
| trader `0xd9Ab�F3c` | `0.013383` | `0.000055` |

The CoW leg alone pulls `2 � margin` of USDC (margin from the solver wallet plus
borrow from the solver escrow), so 5 USDC would need >5 USDC of solver USDC plus
a 10 USDC escrow � roughly 300� the available balance. The fills above were
therefore **sized from live balances** (0.007 USDC and 0.004 USDC at 2x) and are
real, unmocked transactions. The exact same code path (nothing changes but the
amounts) executes at 5 USDC / 10 USDC as soon as the wallets are funded; the
only pre-condition is the USDC transfer succeeding.

### 10.4 Verification

`node scripts/v4/live/verify-cow-intent.cjs` re-derives every claim from chain
state (decodes the broadcast calldata, re-hashes the order UID, reads
`filledOrders`, `filledIntents`, `positions`, the hook's ERC-6909 WETH claim
balance and the escrow) and passed all assertions:

```
ok  both txs mined with status 1
ok  CoW filledOrders[uid] == true (replay-locked)
ok  order.appData == keccak256(appDataJson(2))
ok  order.appData == leverageCommitment(2)
ok  CoW receiver == swapper
ok  CoW sell USDC -> buy WETH
ok  both fills at 2x leverage
ok  CoW position is a 2x long
ok  intent position is a 2x long
ok  filledIntents[fillId] == true (nonce consumed)
ok  intent direction USDC -> WETH
ok  intent minAmountOut == 0 as specified
ok  intent nonce == 1 as specified
ok  escrow drained by each fill (spent, not idle)
```

Artifacts: `scripts/v4/live/proofs/cow-intent-live.json` (verification),
`scripts/v4/live/proofs/remaining-1792930388539.json` (intent broadcast log).
Broadcaster: `scripts/v4/live/cow-intent.cjs` (`sim` / `broadcast` /
`--intent-only`); it can be dry-run end-to-end on an anvil Base fork with
`BASE_RPC_URL=http://127.0.0.1:8545`.

Reproduce:

```bash
# dry run on a Base fork (opens both positions on the fork only)
anvil --fork-url https://mainnet.base.org --port 8545
BASE_RPC_URL=http://127.0.0.1:8545 node scripts/v4/live/cow-intent.cjs sim

# live broadcast (needs funded wallets + gas)
node scripts/v4/live/cow-intent.cjs broadcast
node scripts/v4/live/verify-cow-intent.cjs
```

## 11. 1inch Fusion / Limit Order Protocol v4 fill (2026-10-25)

A real maker-signed 1inch **LOP v4** order was filled on Base Mainnet by
`EswapOneInchFusionSettlement`, which is the *taker* and the maker-signed
post-interaction target. The canonical 1inch LOP
(`0x111111125421cA6dc452d289314280a0f8842A65`) verified the maker signature,
moved USDC maker -> settler, moved WETH settler -> maker, and fired the
`postInteraction` callback that the settler requires before `fill()` returns.

| Field | Value |
|---|---|
| Call | `EswapOneInchFusionSettlement.fill` (`0xD0F10948E5E987d9A04aDf4014178D65042f672c`) |
| Tx | `0x2242c346f57e0fe7fbbf7df945c74c4b3e53b007f841f5f7db9f9e16aa875681` |
| Block / gas | `53072257` / `193,321` (gasPrice `6,000,000` wei) |
| Caller | settler `operator` = solver `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037` |
| Maker / receiver | `0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c` (receiver == maker) |
| Order | USDC -> WETH, `makingAmount=11` (0.000011 USDC), `takingAmount=4,800,000,000` wei WETH |
| Order hash | `0xadfebc31447c7fdafd5a6017a55adbda6f09a63df5d5541bfcf9c066a18900b5` |
| Signature | raw ECDSA over `LOP.hashOrder(order)`, `r=0x1fac0eb4...b3ef`, `vs=0x771fe154...2638` |
| Extension | 52 bytes: `0x0000001400...00` + `0xd0f10948e5e987d9a04adf4014178d65042f672c` |
| makerTraits | `0x8a0000...0000` = no-partial-fills (bit 255), post-interaction call (bit 251), has-extension (bit 249), allowedSender = 0 (anyone) |
| takerTraits | `0x8000003400...011e1a3000` = making-amount mode (bit 255), extension length 52 (bits 224..247), threshold `4,800,000,000` |
| Pre-fund: maker approve | tx `0x78f4f3ae9fe74bb081cb72ca6e5aa4453274a304a9194c5fc92ab2b951387c15` (block 53072252, gas 55,785) |
| Pre-fund: settler inventory | tx `0xf637965d1968c38f196120581920119f58f260955ac6b49231ca3e4e1c0faa1e` (block 53072254, gas 51,309, `4,848,000,000` wei WETH solver -> settler) |
| Replay lock | `pendingFills[orderHash].fulfilled == true`, LOP `rawRemainingInvalidatorForOrder(maker, orderHash) == 0`, LOP `OrderFilled(orderHash, 0)` |

Token flow decoded from the receipt (6 logs, all in this one tx):

```
#559 WETH  Approval(settler -> LOP, 5000000000)          fill() scopes the LOP allowance to maxFillAmount
#560 USDC  Transfer(maker -> settler, 11)                maker -> taker
#561 WETH  Transfer(settler -> maker, 4800000000)        taker -> maker
#562 settler OrderFilled(orderHash, maker, 11, 4800000000)   emitted by fill()
#563 LOP     OrderFilled(orderHash, 0)                   canonical LOP event, fully filled
#564 settler OrderFilled(orderHash, maker, 11, 4800000000)   emitted by postInteraction()
```

Balances after: maker USDC `13,372` (was 13,383), maker WETH `23,900,465,549,112`
(+4,800,000,000), settler USDC `11`, settler WETH `48,000,000` (1% inventory
buffer left over). `fill()` only returns after the callback, so a status-1
receipt is itself proof that the maker-signed extension named this settler.

### 11.1 Size compliance (the deployed cap binds this venue)

The requested 5 USDC / 10 USDC sizes are still not fundable from the current
wallets (see 10.3), but for Fusion there is a second, independent limit: the
deployed settler stores **one** `maxFillAmount = 5,000,000,000` and applies it to
both legs, so the 18-decimal WETH leg is capped at 5 gwei:

| Bound | Value | Effect |
|---|---|---|
| `order.makingAmount <= maxFillAmount` | 5,000,000,000 USDC-units (5,000 USDC) | not binding |
| `takingAmount <= maxFillAmount` | 5,000,000,000 wei WETH (5 gwei) | **binding** |
| WETH out at 96% of the cap | 4,800,000,000 wei | used |
| Fair USDC for that WETH (Chainlink ETH/USD `2333.27`) | 11.1997 USDC-units | truncated to `11` |
| Maker USDC balance | 13,383 units (0.013383 USDC) | sufficient |

The implied order price is `2291.67` USD/ETH, 178 bps below spot, purely because
the USDC leg is a whole unit: 1 unit of truncation on an 11-unit fill. Notional
of the whole fill is 0.000011 USDC / 4.8 gwei WETH.

**Deployment finding.** A single scalar cap cannot serve a 6-decimal maker asset
and an 18-decimal taker asset: 5e9 means 5,000 USDC on one side and 5 gwei
(~0.0000117 USD) on the other. As deployed, the venue can only settle
economically meaningless Fusion orders. The fix is two caps
(`maxMakingAmount`, `maxTakingAmount`) or a cap expressed in a common unit;
until then this settler is only usable at the dust size shown above. No code
change was made here - the live proof is exactly what the deployed bytecode does.

### 11.2 Findings that made the fill work

1. **Signature convention.** The maker must sign the raw digest returned by
   `LOP.hashOrder(order)` (`wallet.signingKey.sign(hash)`, `vs = s | (yParity << 255)`).
   Signing EIP-712 typed data with either `uint256` or `address` order fields
   reverts `BadSignature()` (`0x5cd5d233`); the raw digest gets past signature
   recovery and fails only later with `TransferFromMakerToTakerFailed()`
   (`0x70a03f48`) when the allowance is missing. See
   `scripts/v4/live/fusion-probe.cjs` and `proofs/fusion-probe.json`.
2. **Salt commits to the extension.** `order.salt` must carry
   `keccak256(extension)` (the LOP compares its low 160 bits), otherwise
   `isValidExtension` reverts with `InvalidExtensionHash`.
3. **The taker threshold is a ceiling.** In making-amount mode the low 200 bits
   of `takerTraits` are the *worst* taking amount accepted; the LOP reverts
   `TakingAmountTooHigh()` (`0xfb8ae129`) when `takingAmount > threshold`. A
   "slippage cushion" below the order ratio is therefore wrong - it must be
   >= the order's own ratio. This cost one fork cycle to diagnose.
4. **The settler must hold taker-asset inventory.** `fill()` is the taker, so
   WETH has to sit in the settler before the call; it force-approves the LOP for
   exactly `maxFillAmount` and never more.

### 11.3 Verification

`node scripts/v4/live/verify-fusion.cjs` re-derives everything from the mined tx
alone (decodes the `fill` calldata, recomputes `hashOrder` on the canonical LOP,
recovers the maker from `r`/`vs`, re-checks the extension salt commitment and
both trait bitfields, reads `pendingFills`, `rawRemainingInvalidatorForOrder`,
and rebuilds the token movements from the receipt logs). All 28 assertions pass:

```
PASS  tx mined with status 1
PASS  tx sent to EswapOneInchFusionSettlement
PASS  tx sent by the settler operator
PASS  calldata is fill(order,r,vs,amount,traits,extension,interaction,recipient)
PASS  order.makerAsset == USDC
PASS  order.takerAsset == WETH
PASS  order.receiver == recipient == signature-recovered maker
PASS  signature recovers order.maker
PASS  order hash matches the canonical LOP hashOrder()
PASS  extension salt commitment (low 160 bits of keccak256(extension))
PASS  extension names the settler as postInteraction target
PASS  makerTraits: no partial fills + post-interaction + extension
PASS  makerTraits: no allowed-sender restriction
PASS  takerTraits declares the extension length
PASS  takerTraits is in making-amount mode
PASS  pendingFills[orderHash].fulfilled (postInteraction fired)
PASS  pendingFills[orderHash].recipient == order.receiver
PASS  LOP remaining invalidator == 0 (fully filled)
PASS  LOP emitted OrderFilled(orderHash, 0)
PASS  settler emitted OrderFilled twice (fill + callback)
PASS  settler events agree on orderHash/recipient/amounts
PASS  USDC moved maker -> settler (makingAmount)
PASS  WETH moved settler -> maker (takingAmount)
PASS  no other token movements
PASS  order makingAmount == floor(takingAmount at Chainlink ETH/USD)
PASS  settler holds the bought USDC afterwards
PASS  maker received the WETH
PASS  WETH approval to the LOP was scoped to maxFillAmount
```

Artifacts: `scripts/v4/live/proofs/fusion-live.json` (verification),
`scripts/v4/live/proofs/fusion-probe.json` (signature/extension probe).

Reproduce:

```bash
# read-only sizing + signing + eth_call (no tx)
node scripts/v4/live/fusion-fill.cjs plan

# dry run on a Base fork (approve + inventory + fill happen on the fork only)
anvil --fork-url https://mainnet.base.org --port 8545
BASE_RPC_URL=http://127.0.0.1:8545 node scripts/v4/live/fusion-fill.cjs broadcast

# live broadcast, then independent verification
node scripts/v4/live/fusion-fill.cjs broadcast
node scripts/v4/live/verify-fusion.cjs
```

### 11.4 Scope caveat for 1inch Fusion

A production Fusion auction order names **1inch's own settlement contract** as
the post-interaction target, because that is what the Fusion order extension is
built for. `EswapOneInchFusionSettlement` only settles orders whose maker
deliberately signed *this* address into the extension (a maker opt-in, e.g. a
B2B desk that wants Eswap liquidity on the other side). It is not a generic
taker for 1inch's auction flow, and this proof does not claim it is: what is
proven here is that a real maker-signed LOP v4 order settles atomically through
the canonical 1inch LOP with the settler's callback gate satisfied.

## 12. Aggregator routes: 0x / Enso / ParaSwap / KyberSwap (2026-10-25)

Four real aggregator venues were filled through the *same* deployed entrypoint,
`EswapRouter.swapMultiPoolForAggregator`, at the same notional and the same 2x
long shape. Every route was quoted **fresh**, seconds before broadcast, for
`sellAmount == 8000` with `recipient/receiver == the live router`; none is a
replay of a cached fixture, and each has its own venue entry proxy and its own
trader EOA (the hook allows one open position per `(pool, trader)`, and the
wallets used by the CoW and Fusion proofs already own positions - see 10 and
11).

| Venue | Whitelisted entry proxy | Tx | Block | Gas used |
|---|---|---|---|---|
| 0x Swap API v2 (`allowance-holder`) | `0x0000000000001fF3684f28c67538d4D072C22734` | `0x939b12470ae54395f8489cd9a9226fb7d2ca003e406bdb2abd98d8015130f284` | 53,072,986 | 923,176 |
| Enso Router V2 | `0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf` | `0x15651c9304c96354dc9504a938b5fb548dec30dfc46dcf34c8f3b66ba0b89fb8` | 53,072,978 | 1,390,627 |
| ParaSwap Augustus V6.2 | `0x6A000F20005980200259B80c5102003040001068` | `0x01db75552ba9d6cda07b53c7b4ffd64c2b1a534ce792ea5291a2c7769fa41b02` | 53,072,989 | 883,500 |
| KyberSwap MetaAggregationRouterV2 | `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` | `0xb7ca843014e0bb7a1cc5ca9bac185a62287b2210882381360fd0a745d34b2cac` | 53,072,992 | 1,061,579 |

All four: status `1`, `effectiveGasPrice = 6,000,000` wei, total gas `4,258,882`
(~`0.0000256` ETH).

| Venue | Trader (calldata `trader`) | Route calldata | Output (wei WETH) | `minAmountOut` | Collateral credited | Protocol fee (5 bps) |
|---|---|---|---|---|---|---|
| 0x | `0xA2d79E8D2DD0372668F412dD4d7F6f78505f1922` | 1,700 B, sel `0x2213bc0b` | 3,434,432,582,020 | 3,331,399,604,559 | 3,432,715,365,729 | 1,717,216,291 |
| Enso | `0x180d05fAC11A81F8FDf10b85b989BB0Fe238cfd8` | 4,580 B, sel `0xb94c3609` | 3,656,240,427,382 | 3,546,553,214,560 | 3,654,412,307,169 | 1,828,120,213 |
| ParaSwap | `0xb8F41b45df9C6f664C610Ed9100f750b49979640` | 513 B, sel `0xe8bb3b6c` | 3,421,703,125,788 | 3,319,052,032,014 | 3,419,992,274,226 | 1,710,851,562 |
| Kyber | `0x7f10Fc4C0a4FaF071d00FBb03708BD560cc4895b` | 4,484 B, sel `0xe21fd0e9` | 3,435,561,002,906 | 3,333,494,172,817 | 3,433,843,222,405 | 1,717,780,501 |

Every receipt has the same shape, decoded from logs only:

```
router  USDC 8000 -> venue first hop          margin + borrow leave the router
solver  USDC 4000 -> router                   registered solver funds the borrow leg
venue   WETH      -> router                   delivered output
router  WETH      -> PoolManager (4985...)    whole output settled into the pool
PoolManager       -> hook (6909 claim)        Transfer(router, 0x0, hook, WETH, output)
hook              -> MultiPoolMarginOpened(poolId, trader, 2, 4000, output)
```

Borrowed `4000`, leverage `2`, `isLong = true`, `position.trader == calldata
trader` for all four. The router's pre-existing WETH balance
(`852,386,635,144` wei) is identical before and after each fill, i.e. no route
left value stranded at the router. Total output across the four venues:
`13,947,937,138,096` wei WETH (0.0000139479 WETH); total protocol fee
`6,973,968,567` wei.

| Venue | First USDC hop actually taken by the route |
|---|---|
| 0x | `0x7d6839415693801E94cDC4A7d732C9a3FDBbd1D7` |
| Enso | `0x4Fe93ebC4Ce6Ae4f81601cC7Ce7139023919E003` |
| ParaSwap | `0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C` |
| Kyber | `0x8F10B468b06c6FD214B65F87778827F7D113f996` |

Those are the venues' own sub-routers, not the whitelisted entry proxy - see
12.3 item 4.

> **Correction (see §14).** These fills were sent with `hookData = '0x'`, so
> `swapMultiPoolForAggregator` skipped `deployCollateral` (`EswapRouter.sol`
> lines 1005-1014 only deploy when `hookData` encodes `isMargin = true`). They
> prove routing, settlement and the ERC-6909 claim, but **no collateral was
> deployed into LP**. The LP deployment claim is made only for the adapter
> canary in §14.

### 12.1 Setup and funding transactions

Owner `0x518634753C61342298c3E04326056b3Ce596a566` throughout.

| Purpose | Tx |
|---|---|
| Whitelist 0x AllowanceHolder | `0xbee44f3c5935fb6b94bd3b8f63be6138ac71c9fbdb5e2e5c3bb6b7ecb91d8b5b` |
| Whitelist ParaSwap Augustus V6.2 | `0xba73dd4853e575dd303a45f6d144d6c4a479ddc49763a0b2b651e07a141eb6e1` |
| Whitelist KyberSwap MetaAggregationRouterV2 | `0x4d4c640f0a888bdddbaeca07957739e143ce99005a36a6f002fb5307c68d6cdc` |
| (recon only) whitelist ParaSwap v5 target `0x59C7...` - superseded, unused | `0xaf79c090690178deb766af25c7154c379287f94fa49596ca10a30dd86aad79d5` |
| 0x trader USDC / gas | `0xe98f64e93eceb50252683647a37cf9419091977fa9b8024fbd92e3158bc08185` / `0x6c733c529b86c5b1763426a35634bc5f51d09b70f634edf93b06556060c49863` |
| Enso trader USDC / gas | `0x5270aa5dfd66dcc46538f478e7085b57ad0bd893eb0ea74b169e1c28bead6084` / `0xc73a423000f1025079a142c9f1ae21696d50eb11945c674fc985c48edcc9dfc3` |
| ParaSwap trader USDC / gas | `0x2478c26dcc1865664b8450c9d221587122d791471bbbc8e4f44bd12280e369bf` / `0x32fb148fdde233f68c6983c1a60a3cd5f020c51c2843d78da280b0e0b9ddab5a` |
| Kyber trader USDC / gas | `0x1f44b166f4c6ad464c39fbce1f986879fa4d3c8e83bb8b79d5b44d9bb28e8ce7` / `0x22eb29a9db8ad9dccc6a311683064676214ed2ce0501d99556c7118f1b9709f5` |
| Solver borrow inventory (+4000 USDC) | `0xacf15158c490246029d057d8eca4719f3a95db9a06d5cc204baac1600eef3e9b` |
| 0x trader `approve(router, MaxUint256)` | `0xad3ce3ce54783017ba4ad307004a47977f6b694d42c63b5a56f6d36145bbc862` |
| Enso trader `approve(router, MaxUint256)` | `0x4d9db6de503c3b1cd8c3bffd963a47ad99673f5e351e76a137427d440e11526e` |
| ParaSwap trader `approve(router, MaxUint256)` | not captured by the setup log - it is that trader's only outgoing tx before its fill (see 12.1 note) |
| Kyber trader `approve(router, MaxUint256)` | `0x38e9e7b2587e852073fecc9c0fbad934e2b181f53a0a8e9eaa04696501e13373` |

Enso was already whitelisted from the original deployment, so it needed no
setup tx. `agg-fill.cjs setup` only persists whitelist + fill steps to
`proofs/agg-setup-*.json`, which is why the ParaSwap approval hash is not in
this table; the approval itself is proven by that venue's fill (the router
`transferFrom`s the trader's `4000` USDC-units and the tx mined with status 1).

### 12.2 Verification (108/108)

`node scripts/v4/live/verify-aggregator.cjs` re-derives every claim from the
mined transaction + receipt alone - router calldata (`SwapParams` +
`AggregatorRoute`), ERC-20 `Transfer` logs, the PoolManager ERC-6909 mint, the
hook's `MultiPoolMarginOpened` event, and the hook's post-fill position storage.
It applies the same 27 assertions to each of the four venues and exits non-zero
on any failure:

```
tx mined with status 1
tx sent to the live EswapRouter
tx sent by the trader encoded in calldata
calldata is swapMultiPoolForAggregator(SwapParams,address,AggregatorRoute)
route.exchangeProxy is the <venue> proxy
route.tokenIn == USDC
route.tokenOut == WETH
route.sellAmount == notional (margin + borrow)
route.value == 0 (no native leg)
params: USDC -> WETH long
params: 2x leverage, margin 4000 USDC-units
params.solver == registered solver
params.key is the hook pool [WETH,USDC,3000,60,hook]
params.standardPoolKey is the std [WETH,USDC,500,10,0x0] pool
fill is NOT replaying the stale fixture taker
router USDC out to the venue == notional (8000)
solver funded the borrow leg directly (4000 USDC)
venue delivered WETH to the router (output > 0)
router forwarded the whole output to the PoolManager
PoolManager minted the ERC-6909 WETH claim to the hook
hook emitted MultiPoolMarginOpened(poolId, trader, 2, 4000, received)
position.collateral == output - protocol fee
position.borrowed == 4000 USDC-units, 2x, long
position.trader == calldata trader
output cleared minAmountOut
fill left no dangling WETH at the router (balance unchanged vs pre-fill block)
venue allowance reset to 0 (AUDIT CRIT-5)
```

Result: **108/108 (27 x 4)**, `allPassed = true`. The artifact
`scripts/v4/live/proofs/aggregator-live.json` now also carries OpenOcean (§13),
so a fresh run reports **135/135 (27 x 5)**.

### 12.3 Findings that made the fills work

1. **0x `swap/v1` is sunset.** `GET /swap/v1/quote` answers
   `404 no Route matched with those values` for every size tested (8,000 to
   1,000,000 USDC-units on Base, 1 USDC on Ethereum mainnet), with and without a
   valid `0x-api-key`); `/swap/v2/quote` behaves identically. `/swap/permit2/quote`
   *does* quote, but its `allowanceTarget` is Permit2
   (`0x000000000022D473030F116dDEE9F6B43aC78BA3`) and the router grants no
   Permit2 allowance (that needs a separate signed permit), so it cannot fill.
   `/swap/allowance-holder/quote` (headers `0x-api-key`, `0x-version: v2`) is the
   only viable path, and it is a perfect fit: `transaction.to == allowanceTarget
   == 0x0000000000001fF3684f28c67538d4D072C22734`, exactly the address the
   router `forceApprove`s for `notional`.
2. **ParaSwap default (v5) routes pull through a second address.** The v5 target
   `0x59C7C832e96D2568bea6db468C1aAdcbbDa08A52` never pulls the input itself -
   it delegates to `TokenTransferProxy 0x93aAAe79a53759cD164340E4C8766E4Db5331cD7`.
   The router approves only `route.exchangeProxy`, so the fill reverts with
   `ERC20: transfer amount exceeds allowance`. `version=6.2` collapses both roles
   into Augustus `0x6A000F20005980200259B80c5102003040001068`
   (`contractAddress == tokenTransferProxy`), which matches the router's single
   approval and fills. `/transactions` additionally needs `ignoreChecks=true`,
   otherwise it 400s because it simulates balances/allowances for the router
   that do not exist before the fill.
3. **Enso and Kyber need no tricks.** Enso is a single `GET
   /shortcuts/route` (bearer key) and Kyber a `GET /routes` + `POST
   /route/build` pair (`x-client-id`); both return `tx.to == routerAddress ==`
   the whitelisted proxy.
4. **Whitelisting an entry proxy is not whitelisting one address.** In every
   route the first USDC hop out of the router is the venue's own sub-router
   (the table above), which the route calldata chooses. `allowedAggregators`
   therefore means "trust this venue's entrypoint with the approved notional",
   and the approval is scoped to exactly `notional` and reset to `0` afterwards
   (asserted). It does not constrain downstream hops - that is inherent to
   aggregator routing, and is why the audit check is the zeroed allowance rather
   than the hop list.
5. **The checked-in route fixtures are historical, not replayable.**
   `BaseParaSwapRoute.sol` / `BaseEnsoRoute.sol` / `BaseKyberRoute.sol` were
   captured at `REF_BLOCK 52954797` for taker `0x0E5a7a0e...` at 100 USDC, and the
   ParaSwap one names the v5 proxy. They remain useful as fork-test inputs but
   cannot be broadcast; the live run regenerates calldata per venue, and the
   verifier asserts the mined calldata does **not** contain the stale taker.
6. **v4-core ERC-6909 event shape.** `Transfer(address caller, address indexed
   from, address indexed to, uint256 indexed id, uint256 amount)` - four topics,
   with `caller` in the data word *before* `amount`. A first verifier draft that
   read `data` as `(id, amount)` (the ERC-20 layout) failed the mint check; the
   fix is in `verify-aggregator.cjs`.

### 12.4 Size caveat

The requested target was 5 USDC margin / 10 USDC escrow. That was **not**
fundable from the wallets at broadcast time, so - exactly as in 10.3 and 11.1 -
the live proof is scaled:

| Field | Requested | Actually filled |
|---|---|---|
| Margin | 5 USDC | `4000` USDC-units = **0.004 USDC** |
| Notional (sellAmount) | 10 USDC | `8000` USDC-units = **0.008 USDC** |
| Leverage | 2x | 2x (unchanged) |

Balances when the four fills were assembled: owner `5,644` USDC-units and
`7.2e13` wei ETH, and each dust trader's `4,000` units consumed by its own fill.
Correction: the solver is not left with `12,000` units. Its inventory had been
drained to `0` by the four §12 borrow legs; §13 re-funded it. The four fills together cost `0.0000256` ETH in
gas. Nothing about the mechanism depends on the size - what is proven is the
route, the approval scope, the venue hand-off, the pool settlement and the
hook accounting - but this proof does not claim a $5 trade, and it should not be
read as one.

Reproduce:

```bash
# whitelist venues + fund the dust traders (owner txs; no-op if already done)
node scripts/v4/live/agg-fill.cjs setup

# fresh quotes + eth_call preflight only, no tx
node scripts/v4/live/agg-fill.cjs sim

# live broadcast per venue
node scripts/v4/live/agg-fill.cjs broadcast --only=enso
node scripts/v4/live/agg-fill.cjs broadcast --only=0x,paraswap,kyber

# independent verification from the mined txs
node scripts/v4/live/verify-aggregator.cjs
```

Broadcaster: `scripts/v4/live/agg-fill.cjs`. Raw run logs:
`scripts/v4/live/proofs/agg-setup-*.json`, `agg-broadcast-*.json`.

## 13. OpenOcean Exchange route (2026-10-25)

OpenOcean joins the four §12 venues as a fifth aggregator. It was filled through
the same deployed entrypoint, `EswapRouter.swapMultiPoolForAggregator`, at the
same dust notional and 2x long shape, by its own dust trader.

| Field | Value |
|---|---|
| Tx | `0xfc6cdeea65115322226a83035d94bf50cd49e4138572bc487315039f96ea4daf` |
| Block / gas | `53,085,140` / `1,047,523` (gasPrice `6,000,000` wei, status `1`) |
| Venue entry proxy (whitelisted) | OpenOcean Exchange `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64` |
| First USDC hop taken by the route | `0x8d8F598c1739e518b871815Dd1f20eA3C169c360` |
| Trader (calldata `trader`) | `0x88BED7b061bF18Ea9449A243638392D38Fd189C8` |
| Route calldata | 3,044 B, selector `0x90411a32` |
| Output (wei WETH) | `3,414,495,427,086` |
| `minAmountOut` | `3,311,958,026,873` (OpenOcean's own `minOutAmount`, 3% slippage) |
| Collateral credited | `3,412,788,179,373` |
| Protocol fee (5 bps) | `1,707,247,713` |
| Position | borrowed `4000`, leverage `2`, `isLong = true`, trader == calldata trader |
| Router WETH | `852,386,635,144` before and after (nothing stranded) |

The fill's `minAmountOut` uses the venue's own floor, not the broadcaster's
generic 3% recompute, so the on-chain check compares against OpenOcean's own
number. The router's `forceApprove` went to the same proxy the route calls, and
the allowance was reset to `0` afterwards (asserted).

> **Correction (see §14).** Like §12, this fill used `hookData = '0x'`, so no
> collateral was deployed into LP. Only routing, settlement and the ERC-6909
> claim are proven here.

### 13.1 Quote provenance (Cloudflare)

`open-api.openocean.finance` sits behind a Cloudflare managed challenge. From
Node, both `/v3/8453/quote` and `/v3/8453/swap_quote` return `403` with an HTML
challenge page, with or without a browser User-Agent. The quote was therefore
captured from a real Chrome session instead: a same-origin `fetch()` of
`/v3/8453/swap_quote?inTokenAddress=USDC&outTokenAddress=WETH&amount=0.008&gasPrice=0.006&slippage=3&account=<router>`,
saved as a download and copied into `scripts/v4/live/proofs/openocean-quote.json`.

- The quote was taken at chain block `53,085,092`, with `outAmount`
  `3,417,913,340,426`, and was broadcast minutes later. The fill delivered
  `3,414,495,427,086` (-0.10%), within the `minOutAmount` floor.
- `gasPrice` is passed in gwei. `0.006` matches the live Base gas price. An
  earlier probe with `gasPrice=5` routed through different pools and quoted a
  lower output, so the value you pass changes the chosen route.
- `agg-fill.cjs` refuses a quote file older than 15 minutes, whose `to` is not
  the expected OpenOcean router, or which carries native value.

### 13.2 Setup and funding

| Step | Tx / note |
|---|---|
| Whitelist OpenOcean router | `0x40aba162dbbf25872b034f88ad591257d3332622eb75a16669a40a90888b6158` (block 53,085,110) |
| Dust trader USDC (4000) | `0xfc9f5bca00c4152a2a006497b1c1ac7a4ff8acbc3263aa3549b156aeb6bbd2c9` |
| Dust trader gas (0.00006 ETH) | `0x63dc9c261743bba6736bf8b1608ab4e1c6c511d4e35dfd789b5da6f1ac64a9e1` |
| Trader `approve(router, MaxUint256)` | `0x519895ac0927bead9ead2951e222409e5ec5ffc41ee80bb1bb7599cb4e769933` |
| Solver borrow inventory (4000) | `0x4599c39f4ce7c07d1d93c6b6904e11de9a2778be0e9132f25912841b294030f6` (block 53,085,129), sent by the Fusion/CoW maker wallet `0xd9Aba9723d14b36588bcF9D47c2FF355EEC47F3c` |

The solver top-up came from the maker wallet, not the owner. After funding the
new trader, the owner had `1,644` USDC-units, which was not enough for the
solver's `4000`. The maker wallet held `13,372` units and has no use for them
here, since its position already exists and the borrow leg is pulled from the
solver. Both are the project's own test wallets (`.env`).

### 13.3 Verification

`node scripts/v4/live/verify-aggregator.cjs` applies the same 27 assertions to
OpenOcean. Result: **27/27 for OpenOcean, 135/135 across five venues**
(`scripts/v4/live/proofs/aggregator-live.json`, `allPassed = true`).

### 13.4 Scope

The same caveat as §12.4 applies. The fill is at 4000 USDC-units margin and
8000 units notional (0.008 USDC), not the 5/10 USDC target. The quote is a real
OpenOcean `swap_quote` response for this router and calldata, but it was
captured from a browser rather than a server fetch, and the 15-minute freshness
check is what keeps that honest.

Reproduce:

```bash
# capture the quote from a Chrome session on https://open-api.openocean.finance
# (Node is blocked by Cloudflare) into scripts/v4/live/proofs/openocean-quote.json

node scripts/v4/live/agg-fill.cjs setup --only=openocean
node scripts/v4/live/agg-fill.cjs broadcast --only=openocean
node scripts/v4/live/verify-aggregator.cjs
```

## 14. New B2B aggregator integrations: whitelist + adapter canary (2026-10-25)

The task asked for these under "§13 New B2B Aggregator Integrations". §13 is
already the OpenOcean entry, so this section is §14.

**Result in short.** Two of the five requested proxies are now whitelisted. One
canary fill ran end-to-end through `EswapLeverageAdapter` (LI.FI), with every
invariant the task listed checked. The other three venues have no live fill
yet: Socket needs an API key, and WOOFi and 1inch Classic need a quote adapter
and funding. Two requested addresses were wrong and were not whitelisted.

### 14.1 Requested targets, checked on-chain before any transaction

| Requested | On-chain check (Base 8453) | Outcome |
|---|---|---|
| LI.FI / Jumper `0x123151509706580380423f72322400a08` | Malformed: 33 hex characters | Not whitelisted. Used the LI.FI Diamond `0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE` instead: the live quote's `transactionRequest.to` and `estimate.approvalAddress` both equal it. **Whitelisted**, tx `0x535f03047e8c2896eb11ada9a4842ea5ab57b78eb0842f6666bea074dc6efd88` (block 53,085,614). |
| Socket / Bungee `0x3a23f3e7313593b5a2701331c430e8a71c841369` | No bytecode | Not whitelisted. Candidate Socket Gateway `0x3a23F943181408EAC424116Af7b7790c94Cb97a5` has bytecode, but the Socket quote API returns `401` without `API-KEY`, and no key exists in `.env`. **Not whitelisted; blocked.** |
| 1inch Classic `0x111111125421ca6dc452d289314280a0f8842a65` | Bytecode present | **Already whitelisted** (`allowedAggregators == true`); nothing to do. |
| OpenOcean `0x6352a56caadc4f1e25cd6c773226378215f740b3` | No bytecode | Not whitelisted. The router used in §13, `0x6352a56caadC4F1E25CD6c75970Fa768A3304e64`, is **already whitelisted**. |
| WOOFi Router V2 `0x133857502e604f32d8479e0a293a5530fa01cc3a` | No bytecode | Not whitelisted. WOOFi Router V2.1 `0x4c4AF8DBc524681930a27b2F1Af5bcC8062E6fB7` is confirmed as WOOFi on-chain (`quoteToken()` = Base USDC, `WETH()` = Base WETH). **Whitelisted**, tx `0x10bb0814d83dc0c40c96d5594a770d0cb1d24fc508bc8b8b54cd29fb6050e241` (block 53,085,616). |

`scripts/v4/live/whitelist-new-aggregators.cjs` runs these checks before it
sends any transaction. It skips any target whose check fails, and it is
idempotent (`--check` does the verification without sending anything).

### 14.2 LI.FI canary through `EswapLeverageAdapter`

The task asked for the adapter path, and it matters for the LP claim. The
adapter sets `hookData = abi.encode(true, leverage, recipient)`, which makes the
router call `deployCollateral` (`EswapRouter.sol` lines 1005-1014). The earlier
router-direct fills in §12 and §13 did not do that.

| Field | Value |
|---|---|
| Tx | `0xb2b5d32c378de0d68cd005f7477bb72e7bf18abaab68419a566699218a1106ef` |
| Block / timestamp | `53,085,680` / `1792960707` |
| Gas / gasPrice | `1,227,912` / `6,000,000` wei, status `1` |
| Call | `EswapLeverageAdapter.exactInputSingleWithLeverageAggregator` (`0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD`) |
| Trader | `0xD2E833134e997929eeD8179E1dd960a0dE898A32` (deterministic key `eswap-aggregator-live-v1/lifi`) |
| Venue | LI.FI Diamond, route via `sushiswap` |
| Notional / margin / leverage | `8000` / `4000` USDC-units / `2x` (0.008 USDC notional, 0.004 USDC margin) |
| Output (wei WETH) | `3,398,456,839,305` (`minAmountOut` `3,296,503,134,125`) |
| Protocol fee (5 bps) | `1,699,228,419` |
| Collateral credited | `3,396,757,610,886` |
| Position | borrowed `4000`, leverage `2`, `isLong = true` |
| LP deployment | `ModifyLiquidity` on the standard pool `0x90333bb05c258fe0dddb2840ef66f1a05165aa7dac6815d24e807cc6ebd943a0`, sender = hook, `liquidityDelta = 5,024,281,015`, ticks `[-198660, -198060]` |
| Router WETH | `852,386,635,144` before and after |

The first broadcast attempt failed with "insufficient funds for intrinsic
transaction cost". That is not a balance problem: the node reserves
`gasLimit × maxFeePerGas` up front. 3.5M × 0.008 gwei ≈ `2.8e13` wei exceeded
the trader's `1.97e13`. The fix was `gasLimit = 2.6M` and `maxFee = 0.006 gwei`
(reservation ≈ `1.56e13`). `MIN_DEPLOY_COLLATERAL_GAS` is `350,000` gas, which
the limit clears.

### 14.3 Invariants from the task

`scripts/v4/live/verify-lifi.cjs` checks all 24 assertions from the mined tx,
its receipt, and post-tx hook and token state. Result: **24/24**
(`scripts/v4/live/proofs/lifi-live.json`).

| Invariant | Result |
|---|---|
| Status 1 on Base | Pass: `status = 1` |
| Proxy allowance reset to 0 | Pass: `USDC.allowance(router, LI.FI) == 0` after the fill |
| ERC-6909 claim minted to the hook | Pass: one `Transfer(0x0 -> hook, WETH, 3,398,456,839,305)` from the PoolManager |
| 80% collateral deployed via `modifyLiquidity` | **Partial: the code deploys 90%, not 80%.** `deployCollateral` caps liquidity at `9/10` of max (`EswapMarginHookLogic.sol:108`). The check uses the closed-form max-liquidity expression in double precision: `deployed / max = 0.8999999998`. The `ModifyLiquidity` event and the position's `liquidity` are both exactly `5,024,281,015`. |
| Zero residual deltas on PoolManager at `unlock()` exit | **Not measured separately.** The PoolManager reverts `CurrencyNotSettled` on any nonzero delta at unlock exit, so `status = 1` implies zero residual deltas. |

The 80% figure in the task does not match the code. The deployed fraction is
90% of the max liquidity for the collateral range. If 80% is the intended
target, that is a contract change, not a verification result.

### 14.4 What did not run, and why

- **Socket / Bungee:** blocked. The quote API requires `API-KEY`, which is not
  in `.env`. Nothing was whitelisted or filled. The gateway in §14.1 still needs
  its route checked with a real key.
- **WOOFi Router V2.1:** whitelisted and verified on-chain, but there is no quote
  adapter yet and no fill. The venue's quote API was not checked from here.
- **1inch Classic V6:** already whitelisted, no adapter, no fill. The API key is
  in `.env`, but there was no USDC left to fund a canary.
- **OpenOcean:** the §13 route already passed verification, but without LP
  deployment. A re-run that deploys collateral needs funding.

**Funding limit.** Each 2x canary needs 4,000 USDC-units for the trader plus
4,000 for the solver's borrow leg. After the LI.FI canary, the owner holds
`1,644` units, the Fusion maker wallet `1,372`, and the solver `0`. That is
`3,016` units, short of one more 8,000-unit canary. The owner also holds only
about `1.1e13` wei of ETH, enough for a few more transactions but not for many
fills. A second fill needs about `8,000` USDC-units to be sent to the solver and
trader wallets, and the owner would need ETH.

### 14.5 Reproduce

```bash
# verify the requested addresses on-chain and whitelist only the checked ones
node scripts/v4/live/whitelist-new-aggregators.cjs --check
node scripts/v4/live/whitelist-new-aggregators.cjs

# LI.FI canary through the adapter (setup funds the trader and solver, sim checks
# the quote with eth_call, broadcast sends the real tx)
node scripts/v4/live/test-new-aggregators.cjs setup --only=lifi
node scripts/v4/live/test-new-aggregators.cjs sim --only=lifi
node scripts/v4/live/test-new-aggregators.cjs broadcast --only=lifi

node scripts/v4/live/verify-lifi.cjs
```

Scripts: `scripts/v4/live/whitelist-new-aggregators.cjs`,
`scripts/v4/live/test-new-aggregators.cjs`, `scripts/v4/live/verify-lifi.cjs`.
Artifacts: `scripts/v4/live/proofs/lifi-live.json`,
`scripts/v4/live/proofs/new-aggregators-*.json`.

## 15. Final artifact summary: all live Base mainnet routes (2026-10-25)

Every row is a mined Base mainnet (chain `8453`) transaction, status `1`. The
verification column counts assertions that passed. Each count comes from a
verifier that reads the mined tx, its receipt, and post-tx state; the artifact
paths are listed in §15.3.

### 15.1 DEX aggregators

| Venue | Path | Tx | Block | Gas | LP deployed | Verified |
|---|---|---|---|---|---|---|
| 0x (AllowanceHolder) | `swapMultiPoolForAggregator` | `0x939b12470ae54395f8489cd9a9226fb7d2ca003e406bdb2abd98d8015130f284` | 53,072,986 | 923,176 | No (§12 correction) | 27/27 |
| Enso Router V2 | `swapMultiPoolForAggregator` | `0x15651c9304c96354dc9504a938b5fb548dec30dfc46dcf34c8f3b66ba0b89fb8` | 53,072,978 | 1,390,627 | No (§12 correction) | 27/27 |
| ParaSwap Augustus V6.2 | `swapMultiPoolForAggregator` | `0x01db75552ba9d6cda07b53c7b4ffd64c2b1a534ce792ea5291a2c7769fa41b02` | 53,072,989 | 883,500 | No (§12 correction) | 27/27 |
| KyberSwap MetaAggregationRouterV2 | `swapMultiPoolForAggregator` | `0xb7ca843014e0bb7a1cc5ca9bac185a62287b2210882381360fd0a745d34b2cac` | 53,072,992 | 1,061,579 | No (§12 correction) | 27/27 |
| OpenOcean Exchange | `swapMultiPoolForAggregator` | `0xfc6cdeea65115322226a83035d94bf50cd49e4138572bc487315039f96ea4daf` | 53,085,140 | 1,047,523 | No (§13 correction) | 27/27 |
| LI.FI Diamond | `EswapLeverageAdapter` | `0xb2b5d32c378de0d68cd005f7477bb72e7bf18abaab68419a566699218a1106ef` | 53,085,680 | 1,227,912 | **Yes**, liquidity `5,024,281,015` | 24/24 |

The gasPrice for every row is `6,000,000` wei.

### 15.2 Additional adapter venues run in this round

| Venue | Path | Tx | Block | Gas | LP deployed | Verified |
|---|---|---|---|---|---|---|
| WOOFi Router V2.1 (sPMM) | `EswapLeverageAdapter` | `0xd012925560da8e9c0c8adbdc53eae29729c05a9c9240fd22b68025937a10c502` | 53,087,817 | 1,195,849 | **Yes**, liquidity `947,679,344` | 24/24 |
| 1inch Classic Router V6 | `EswapLeverageAdapter` | `0x972f11c04a0e0e5eea6bf7b71305fe86462d9cb48bcdda0cb187bd030276ef5a` | 53,087,825 | 1,063,317 | **Yes**, liquidity `939,938,720` | 24/24 |

Both are at the **750-unit margin / 1,500-unit notional** the funding decision
allowed (§15.5), not the 4,000-unit size used elsewhere. Their LP deployment
is at 0.9 of max liquidity, verified with the same closed-form check as LI.FI.

### 15.3 Intent solvers

| Protocol | Path | Tx | Block | Gas | Verified |
|---|---|---|---|---|---|
| CoW Protocol GPv2 | `EswapCoWSettlement.fillOrder` | `0xd2dab148d807b794ba2931853c18c803edb28fab1cfe8b13b2a225cdeac0f48f` | 53,070,361 | 1,104,893 | 14/14 (`verify-cow-intent.cjs`, shared with the next row) |
| Direct solver intent | `EswapRouter.swapWithIntent` | `0x180f452efa7ee76848dd20822ddd2c8887107356ebf3d08717ad4d66878fe7ed` | 53,070,519 | 983,606 | 14/14 (same run) |
| 1inch Fusion (LOP v4) | `EswapOneInchFusionSettlement.fill` | `0x2242c346f57e0fe7fbbf7df945c74c4b3e53b007f841f5f7db9f9e16aa875681` | 53,072,257 | 193,321 | 28/28 (`verify-fusion.cjs`) |
| UniswapX (PriorityOrder, inventory settler) | `EswapUniswapXSettlement.execute` via reactor `0x000000001Ec5656dcdB24D90DFa42742738De729` | `0x649d1c9977f14578ddc4319b72e04b6e339b74e3967d3d19c962473921447506` | 52,996,607 | 216,080 | Checked on-chain: status 1; 1,000 USDC units pulled from the swapper into the settler; 2,000,000,000 wei WETH delivered to the swapper; settler WETH back to 0. See 15.4 |

### 15.4 Not evidenced

- **UniswapX: recovered and checked.** The full hash is
  `0x649d1c9977f14578ddc4319b72e04b6e339b74e3967d3d19c962473921447506`. An
  earlier version of this section had only a prefix, and a repo search found
  nothing, so it was marked unverified. Checked against Base mainnet: receipt
  status 1, block 52,996,607, gas 216,080 at 6,000,000 wei, sent by solver
  `0x3fc88…F037` to the settler `0xEA8fE55A…6Fc`. It moved 1,000 USDC units from
  the swapper `0xd9Aba…47F3` into the settler, and 2,000,000,000 wei WETH from the
  settler to the swapper. The order hash
  `0x8f8bc916…32a0` was reported with the fill but is not in the calldata
  directly, so this check does not re-derive it. The fill script
  `scripts/v4/live/ux-fill.cjs` and the helpers `state.cjs` and `env.cjs` are in
  the repo.
- **Socket / Bungee.** Not run. The quote API requires an `API-KEY` that is not
  configured (§14.4).
- **Fork rehearsals.** WOOFi and 1inch were also run on a local anvil fork of
  Base before the live fills (`http://127.0.0.1:8545`). Those are not mainnet
  proofs and are not in the tables above.

### 15.5 Deviations from the request

- **Funding.** The requested 5,000-unit top-up was not executed. The owner
  (`1,644`) and Fusion maker (`1,372`) wallets together held `3,016` units, so
  the top-up could not come from them. The owner moved its `1,644` to the maker
  (tx `0x5b2bd05cfc6ae33d31a233ca5f5ec9d060f632e12dcbd2bee81a081a5dc4b2f4`), and
  both canaries were run at 750-unit margin, per your choice.
- **WOOFi address.** The requested `0x4c4AF8DB32770281F19b0270a3249052d3f26Fb7`
  fails the checksum and has no bytecode. The verified router
  `0x4c4AF8DBc524681930a27b2F1Af5bcC8062E6fB7` was used instead (§14.1).
- **Margin.** The 750-unit margin is 0.00075 USDC. Those two fills are real and
  verified, but they are small, and they are not the 4,000-unit size used for
  the other rows.

### 15.6 Verification caveats

- **Adapter-venue "WOOFi calldata" check.** It passes trivially for non-WOOFi
  venues (1inch, LI.FI). It only asserts the swap arguments for WOOFi.
- **LP deployment is approximate.** The 90% check uses double-precision sqrt
  prices (tolerance 1e-6 relative). The on-chain liquidity is exact.
- **Netting.** Zero residual PoolManager deltas are implied by `status = 1`,
  because the PoolManager reverts `CurrencyNotSettled` otherwise. This is not
  measured separately.
- **80% vs 90%.** `deployCollateral` deploys `9/10` of max liquidity, not the
  80% in the request (`EswapMarginHookLogic.sol:108`). The check reflects the
  code, not the request.

### 15.7 Artifacts

- Aggregators (router-direct): `scripts/v4/live/proofs/aggregator-live.json`
  (135/135 across five venues).
- LI.FI: `scripts/v4/live/proofs/lifi-live.json`.
- WOOFi: `scripts/v4/live/proofs/adapter-d0129255.json`.
- 1inch Classic: `scripts/v4/live/proofs/adapter-972f11c0.json`.
- CoW + direct intent: `scripts/v4/live/proofs/cow-intent-live.json`.
- Fusion: `scripts/v4/live/proofs/fusion-live.json`.
- Broadcast logs: `scripts/v4/live/proofs/new-aggregators-broadcast-*.json`.

### 15.8 Reproduce

```bash
node scripts/v4/live/verify-aggregator.cjs
node scripts/v4/live/verify-lifi.cjs
node scripts/v4/live/verify-adapter.cjs 0xd012925560da8e9c0c8adbdc53eae29729c05a9c9240fd22b68025937a10c502
node scripts/v4/live/verify-adapter.cjs 0x972f11c04a0e0e5eea6bf7b71305fe86462d9cb48bcdda0cb187bd030276ef5a
node scripts/v4/live/verify-cow-intent.cjs
node scripts/v4/live/verify-fusion.cjs
```

## 16. Fixes to the §15 caveats (2026-10-26)

Caveats that depend on funding (the 750-unit margin size) were left alone.

### 16.1 UniswapX verifier: closed

`scripts/v4/live/verify-uniswapx.cjs` is a read-only verifier for the live
fill `0x649d1c99…7506`. It decodes `fill(order, sig)`, re-derives the
PriorityOrder hash with the reactor's EIP-712 rules, and recovers the swapper
from the Permit2 witness signature. Result: **14/14**
(`scripts/v4/live/proofs/uniswapx-live.json`). The re-derived order hash is
`0x8f8bc916b5749e9eb0f83fd5b3c4041801d606388093860e7a0e8f25e04e32a0`, which
matches the reported value. The reactor's fill event carries the same hash.

### 16.2 Router-direct fills: LP deployment fixed (fork-proven)

`scripts/v4/live/agg-fill.cjs` now sends `hookData = abi.encode(true, leverage,
trader)`. That is the flag `EswapRouter` checks before `deployCollateral`
(lines 1005-1014). On a local Base fork, a router-direct Enso fill deployed LP:
liquidity `5,186,829,947` across ticks `[-198720, -198120]`, status 1. Before the
change, the same path deployed nothing. The fork is a rehearsal, not a live
proof. A live proof needs a funded run, which is out of scope here.

The broadcaster also gained an optional `AGG_TRADER_SALT`. It only changes the
deterministic trader key when set, so default runs are unchanged. It exists so a
rehearsal can use a fresh trader on the fork.

### 16.3 Fusion settler: split caps (code and tests done; not redeployed)

`EswapOneInchFusionSettlement` replaces the single `maxFillAmount` with
`maxMakingAmount` (USDC-side) and `maxTakingAmount` (WETH-side). The LOP
approval and the taking-amount check use `maxTakingAmount`. The making-amount
check uses `maxMakingAmount`. The constructor takes both.

- `forge test --match-path src/v4/test/EswapVenueSettlementTest.t.sol`: **23/23**,
  including a new test that the two caps are stored independently.
- Deploy scripts read the new `ONEINCH_FUSION_MAX_TAKING`. When it is unset, the
  taking cap falls back to `ONEINCH_FUSION_MAX_FILL`, so existing deploy
  behaviour is unchanged.

**Not done:** the live settler still has the old single cap. Redeploying it is a
mainnet action, and it needs a chosen WETH cap. The value is your decision.
After redeploy, `fusion-fill.cjs`, `fusion-probe.cjs`, and `verify-fusion.cjs`
still read `maxFillAmount()` and must be updated to the new getters.

### 16.4 Socket: still blocked

The Socket quote API needs `API-KEY`, which is not configured. Nothing can be
fixed without a key. The whitelist script already gates Socket on a live quote,
so adding `SOCKET_API_KEY` to `.env` is the only step needed.
