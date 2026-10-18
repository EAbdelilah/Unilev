# Eswap v4 — Complete-Cycle Proof

**Claim under test:** the Eswap protocol can run a *complete* leveraged cycle —
real aggregator demand opens a position through the Eswap core, and a solver
supplies the borrowed leg — and unwind it, with the solver repaid exactly and
the protocol holding none of its own capital.

**Status:** proven at the *mechanism / integration* level on forked Base and
Ethereum mainnet, against **real aggregator contracts and real calldata**.
This document states exactly which parts are real and which are simulated.
It does **not** claim a live mainnet settlement with an external solver.

---

## 1. Result matrix

| Chain | Demand source | Fixture (ref block) | Test contract | Result |
|---|---|---|---|---|
| Base `8453` | Enso bundle | `BaseEnsoRoute` (block `52628092`) | `EswapBaseEnsoFullCycleForkTest` | **3/3 PASS** |
| Ethereum `1` | Enso bundle | `MainnetEnsoRoute` | `EswapMainnetEnsoFullCycleForkTest` | **3/3 PASS** |
| Ethereum `1` | 0x quote | `Mainnet0xRoute` | `EswapMainnet0xFullCycleForkTest` | **2/2 PASS** |
| Sepolia `11155111` | CoW bytes | — | `EswapSepoliaDomainCompatTest` | **7/7 PASS** |

Gas (fork-local, open+close): Base Enso round trip `1,202,476`; moat test
`1,191,043`; mainnet Enso open `1,045,194`; mainnet 0x open `1,025,228`.

---

## 2. What each leg actually does

```
open:   real aggregator bundle / quote calldata
        -> EswapLeverageAdapter.exactInputSingleWithLeverageAggregator
        -> EswapRouter._multiPoolOpenAggregator
        -> exchangeProxy.call(realCalldata)          (real EnsoRouter / 0x proxy)
        -> EswapMarginHook accounting (position + solver debt)
close:  EswapRouter.closePosition -> hook unwind -> solver repaid principal
```

The borrowed leg is drawn **entirely from the solver's pre-deposited bond**
(`router.depositBorrowEscrow` → `erc20BorrowEscrow`), settled against the real
V4 `PoolManager` inside one `unlock`. Eswap seeds no liquidity of its own on the
fill venue.

### Base Enso fixture facts (`src/v4/test/fixtures/BaseEnsoRoute.sol`)
- Generated `2026-10-15T06:25:32Z` by `javascript/v4/realApis/gen-enso-base-fixture.js`
- `exchangeProxy` `0xF75584eF6673aD213a685a1B58Cc0330B8eA22Cf` (EnsoRouter V2)
- sell `100000000` USDC → expected `42448580514446653` WETH, min `42321234772903313`
- `fromAddress`/`receiver` = the fixed taker `0x0E5a…0e5A`

---

## 3. Assertions proven (Base Enso `test_BaseEnso_FullCycle_AggregatorOpen_ThenClose`)

- Position credited to the recipient: `positions(...).trader == trader`.
- Collateral equals the real fill output, net of the protocol reserve.
- `leverage == 2`; `borrowed == margin × (leverage − 1) == solverPrincipal`.
- Solver debt registered: `solverDebts(poolId, trader, solver).solver == solver`.
- Router retains **zero** fill output.
- After close: position cleared, collateral `0`, LP stake `0`.
- **Solver recovers the exact principal** on close.
- Round trip leaks no free money: trader recovers `>88%` and `<101%` of margin.

### Moat (`test_Moat_SolverFundsBorrow_ProtocolHoldsZeroCapital`)
- Borrow drawn solely from the solver's bond; `erc20BorrowEscrow` drops to `0`.
- Router and hook hold **zero** USDC/WETH of their own before **and** after.
- Trader spends exactly its margin; solver USDC unchanged during open.
- `solverDebts(...).principal == borrowLeg` (senior debt).

---

## 4. Byte-compatibility with real CoW solvers

`javascript/v4/realApis/index.js` reproduces the canonical CoW EIP-712 bytes and
compares them to pinned vectors that the on-chain `EswapSepoliaDomainCompatTest`
also enforces:

| Anchor | Value | Result |
|---|---|---|
| Sepolia domain | `0xdaee378b…92ed230b` | MATCH |
| Unichain Sepolia domain | `0xd815a6a9…9b932384` | MATCH |
| Gnosis domain | `0x8f05589c…a466bc7` | MATCH |
| Fixed order digest | `0x5a5d9a27…1fd5c9a4` | MATCH |
| `KIND_SELL` / `COW_TYPE_HASH` | `ethers.id(...)` | MATCH |

The decisive check reads the **live** contract's own answer:
`ICowDomainSeparator(0x9008…ab41).domainSeparator()` on Sepolia equals our value.

> **Fix applied:** `fixedOrder()` in `javascript/v4/realApis/cowOrderBook.js` had
> drifted — its `appData` was repurposed to `leverageCommitment(1)`, which broke
> the pinned digest (`0xc87f…` vs anchor `0x5a5d…`). `fixedOrder()` now uses the
> canonical `keccak256("eswap-real-cow-sepolia")` again (matching the on-chain
> `FIXED_APP_DATA`); the leverage-committed variant moved to a separate
> `fillableProbe()`. All anchors now MATCH.

Live demand/supply rails are reachable: CoW order book (Gnosis `REAL_QUOTE`),
1inch `REAL_QUOTE`, ParaSwap chain-130 `REAL_QUOTE`.

---

## 5. Real vs simulated

| Component | Status |
|---|---|
| Aggregator contracts (EnsoRouter, 0x ExchangeProxy) | **REAL** — forked bytecode |
| Route calldata | **REAL** — live Enso bundle / real 0x quote |
| V4 `PoolManager` | **REAL** — canonical Base `0x4985…2b2b`, mainnet `0x0000…8A90` |
| Fill venue liquidity | **REAL** — forked DEX pools (mainnet 0x closes on the real 3000/60 pool) |
| CoW domain/digest | **REAL** — verified against live GPv2Settlement |
| Eswap contract code | **REAL** — compiled Solidity |
| Solver identity | simulated — `makeAddr(...)` pseudo-address |
| Solver / trader capital | simulated — `deal()` cheatcodes |
| Price oracle | simulated — `PriceFeedMock` |
| Hook / router / adapter | freshly deployed via `deployCodeTo`, not the live Base stack |
| Mainnet broadcast | none — the fork swallows execution |

---

## 6. Reproduce

```bash
# byte-compat anchors + live rails
node javascript/v4/realApis/index.js

# full cycles (BASE_RPC_URL optional; defaults to mainnet.base.org)
forge test --match-contract EswapBaseEnsoFullCycleForkTest -vv
forge test --match-contract EswapMainnetEnsoFullCycleForkTest -vv
forge test --match-contract EswapMainnet0xFullCycleForkTest -vv

# on-chain byte-compat (needs ETH_SEPOLIA_RPC_URL)
forge test --match-contract EswapSepoliaDomainCompatTest -vv
```

Regenerate the Base fixture (needs `ENSO_API_KEY`):
`node javascript/v4/realApis/gen-enso-base-fixture.js`.

---

## 7. What this does NOT prove

1. **No live settlement.** Nothing is broadcast; no external party participated.
2. **No aggregator lists Eswap yet.** Enso/0x pathfinders do not route through
   the Eswap hook; listing is an intake/business step (`docs/b2b/`).
3. **The live Base USDC oracle blocker was fixed by a redeploy (see §9).** The
   original live stack reverted `StalePrice()` because `PriceFeed.MAX_ORACLE_AGE
   = 3600` (`src/v4/PriceFeed.sol:66`) is shorter than the raw Chainlink USDC/USD
   heartbeat (~24h). A fresh stack was deployed on 2026-10-16 with a
   `UsdcTwapFeed` adapter registered as the USDC feed, so `getTwapPrice(USDC)` is
   now always fresh. No open has yet been settled live (no funded trader).
4. **Solver capital is not contract-guaranteed.** On a bad unwind the insurance
   fund is drawn first and any remainder is recorded as `badDebt` — payment
   priority, not a guarantee.
5. **Solvers are whitelist-gated** (`router.setSolverWhitelist`); an arbitrary
   external wallet cannot settle.

---

## 8. Live Base validation — pre-fix finding (executed, read-only)

Harness: `scripts/v4/live-base-validate.cjs` — every leg exercised against **Base
mainnet (8453)**, no transaction signed or broadcast (`eth_call` / HTTP only).

Run: `node scripts/v4/live-base-validate.cjs`

Observed (block `52655547`):

| Leg | Live result |
|---|---|
| [A] Aggregator demand — Enso API | `amountOut 2032933418557304`, route `swap:kyberswap`, **references Eswap: NO** |
| [B] Solver supply — CoW order book | reachable (`v2.383.0`); live quote returned on an earlier probe (`buy 6955187389541`, fee `3171`) |
| [C] Eswap core — live Base v4 | router.owner = deployer; `allowedAggregators(EnsoRouter)=true`; solver `0xe18b…` whitelisted; hook pool WETH/USDC 3000/60 initialized; `hook.priceFeed` = `0xc7adf…` (**immutable**) |

**Blocker (on-chain):**

```
oracle USDC/USD updatedAt age : 31799s  -> STALE (age > MAX_ORACLE_AGE 3600s)
oracle ETH/USD  updatedAt age : 133s    -> FRESH
PriceFeed.getTwapPrice(USDC)  : REVERT StalePrice() 0x19abf40e
```

The live `PriceFeed` has no `setMaxOracleAge` (selector `0x80236480` absent), so
the 1h cap is hard-coded, and `hook.priceFeed` is immutable. Therefore **no
USDC-margined open can settle live** outside a ≤1h window after a USDC/USD feed
update, and the fix is a hook + PriceFeed redeploy (not a parameter change).

**Verdict:** demand rails PASS (live), supply rails PASS (live),
**live settlement was BLOCKED at the core by the stale USDC oracle** — fixed by
the redeploy recorded in §9.

---

## 9. Live redeploy + post-fix validation (executed, real mainnet txs)

To remove the §8 blocker, a **new stack was deployed to Base mainnet** with the
oracle fix embedded in `scripts/v4/DeployBase.s.sol::deployPriceFeed` — it now
deploys and registers a `UsdcTwapFeed` adapter (V3 USDC/WETH TWAP × Chainlink
ETH/USD) instead of the slow Chainlink USDC/USD Reference feed.

- Hook CREATE2 salt: `0x…01f4ca` (128,202 tries)
- Deploy cost: ≈28.2M gas total (~0.000161 ETH at 0.006 gwei)

| Contract | Address |
|---|---|
| PriceFeed | `0xE6E7229f878fB2d7dAbAcD2873A9ea4A3c04aFf8` |
| USDC TWAP adapter | `0x879F65DfCF6C0758E1a1a028a6D21bF3DA55cBd9` |
| Hook | `0x6f98Ea19e522Ecc706E0Fb1574BDA8D32aC510C8` |
| HookLogic1 | `0x27C281808989bF51d972f1Bb0f896CC45CB9a756` |
| HookLogic2 | `0xc880ceb6ec079011e0b922b17f439dacd00D5Aab` |
| Router | `0x57E75A87A62ab8Ff14C59FA10Ac2AB2c8cBD45D1` |
| RouterExt | `0x32C03981aC81054b470f9104d67c18227aBcb35b` |
| LiquidationKeeper | `0xb7ce4c1b40BBd537091E973B3c3C7DEB35106A7d` |

Post-deploy wiring verified on-chain: `hook.priceFeed` = new PriceFeed;
`isAuthorizedPool` = true; `baseCurrency` = WETH; `standardPoolKeys` =
WETH/USDC 500/10; `allowedAggregators(EnsoRouter)` = true; `registeredSolvers(solver)`
= true (whitelisted post-deploy). Pool id
`0xcebee673dfdc9bc1f4b1e24cd0f21b437869660fbe0ecaf697ec4acd04c87231` initialized
(`sqrtPriceX96 ≈ 3.9e24`).

Post-fix live validation (`node scripts/v4/live-base-validate.cjs`, block `52657141`):

| Leg | Live result |
|---|---|
| [A] Aggregator demand — Enso API | `amountOut 2034789144861641`, route `swap:bitget` — **PASS** |
| [B] Solver supply — CoW order book | reachable (`v2.383.0`) — **PASS** |
| [C] Eswap core — live Base v4 | `getTwapPrice(USDC) = 999348198041917538` (fresh, 18-d adapter) — **PASS** |
| — | `router.quoteExactInput($5, 2x) = 4030480329921391` WETH — view path live |

**Verdict:** the live core is **UNBLOCKED** — `getTwapPrice(USDC)` no longer
reverts; demand + supply rails PASS live. The route still does **not** reference
Eswap (Enso has not listed it), and no external solver participated — those stay
business/integration steps, unchanged by the redeploy.
