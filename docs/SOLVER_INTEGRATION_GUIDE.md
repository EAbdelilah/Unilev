# Eswap Solver Integration Guide (Base mainnet, chain 8453)

This guide is for external solvers and market makers who want to fill Eswap
leveraged opens with their own capital. It covers the economics, the live
contracts, the fill paths, and a working example.

Status: the contracts below are live on Base. The fill paths are tested on a Base
fork (`src/v4/test/ExternalSolverZeroTreasury.t.sol`). No external solver has
filled on the live stack yet. The sections marked **Not yet** list what is
missing.

---

## 1. Economics for a solver

### 1.1 The trade

A trader posts margin `M` and leverage `L`. Eswap borrows `B = M × (L − 1)` from
the **solver**, not from the protocol. The borrowed amount is the solver's
principal. The position's collateral is the bought asset, and the trader owns it
minus the protocol fee.

Example: `M = 1,000 USDC`, `L = 5`. The solver supplies `B = 4,000 USDC`. The
protocol charges 10 bps of the bought collateral on open (`reserveFactor = 10`).
Eswap charges no interest.

### 1.2 Where the solver earns

| Source | Mechanism (as implemented) |
|---|---|
| Rehypothecation LP fees | At unwind, the hook compares the collateral it recovers with the principal it deployed into the Uniswap V4 band. The excess is LP yield. `_distributeRehypothecation` (EswapMarginHookLogic2) pays 100% of it to `positionSolver[poolId][trader]`. If no solver is recorded, the trader receives it. |
| Spread / batch execution | The solver chooses its own execution (routing, batching) and keeps the difference, as long as the trader's signed `buyAmount` floor holds on chain. |

The yield is **realised at unwind**, meaning on close, partial close, rebalance or
liquidation. It is not streamed continuously. Its size depends on swap volume
through the band while the position is open. **No APY figure is promised here.**
A solver's return is `(LP yield realised) / (principal × time deployed)`, and both
inputs depend on volume.

### 1.3 Seniority of the solver's principal

On close or liquidation, the solver's claim is paid before the trader's residual:

- `totalPayout = solverDebts.principal + solverDebts.accumulatedYield`
  (EswapMarginHookLogic2, `_settle`). The solver is paid from the unwind proceeds
  first. In liquidation, the liquidator reward is computed on what remains after
  the solver's claim.
- If proceeds fall short, the shortfall is covered by the insurance fund, up to
  `insuranceCoverageBps` of the shortfall. The default is `10_000` (100%), capped
  by the fund's balance.
- Any remainder is recorded as protocol bad debt. **The solver then takes the
  loss.**

**Correction to a common description:** the senior claim is not zero credit risk.
It is senior, and it is backed by collateral first and by the insurance fund
second. A position can still leave the solver short when both are exhausted. The
solver should size its exposure on that basis. `insuranceFund(currency)` and
`insuranceCoverageBps()` are public, so the current backstop can be read on chain.

### 1.4 Where the protocol's money is

The protocol spends no borrow capital. Its revenue is the 10 bps on open. That fee
is accrued in `protocolFees[collateral]` and withdrawn by the owner. The insurance
fund does back solver losses, so **the protocol does hold some capital at risk
(the insurance fund)**. That is a real exposure, and this guide does not describe
it as zero.

---

## 2. Live Base mainnet contracts

Addresses are the **live** 2026-11-11 full-stack redeploy (MAINNET_PROOF.md §19).
Each one was checked on chain for bytecode and for its wiring.

| Contract | Address | Notes |
|---|---|---|
| `EswapRouter` | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` | Borrow escrow, `swapMultiPoolForSolverFunded`, `swapWithIntent` |
| `EswapMarginHook` | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` | Positions, `positionSolver`, `solverDebts` |
| `EswapCoWSettlement` | `0x7341859C0D7e039118b3f85F341583EBCDB8c960` | `router()` = live router ✓, `gpv2Settlement()` = `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` ✓ |
| `EswapSettlement` (generic, ERC-7683) | `0x6F347acB3bD901731e192d482b7a40c50f30FCa1` | `fill` has no operator gate |
| `EswapUniswapXSettlement` | `0x8cB966a5102444BbeD5A222AcE1b88d0421b0cB2` | **Operator-gated** (see §4.3) |
| `EswapOneInchFusionSettlement` | `0x587f01dE3c42eB5E6a9DBA7a3026719F6F95FBbb` | **Operator-gated** (see §4.3) |
| `EswapLeverageAdapter` | `0xC622558e9145dbe0Bc37Db5311e70f3F9Fa8cc48` | |
| `EswapLeverageQuoter` | `0xb1228De759119088D9aCEf20b80dD4ED93Dd2ba5` | |
| `PriceFeed` | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` | |
| Uniswap V4 `PoolManager` | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | |
| GPv2 Settlement (CoW) | `0x9008D19f58AAbD9eD0D60971565AA8510560ab41` | Signature domain |
| WETH | `0x4200000000000000000000000000000000000006` | |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | |

**Do not use these retired addresses.** They belong to the 2026-10-20 stack, which
was replaced:

| Retired | Address |
|---|---|
| Router | `0xD3360D67E366Cac21a1c18fC9100B93be79e1437` |
| Hook | `0xe33A630503c640143126BBF222a82689D49b50c8` |
| CoW settlement | `0xA9b26F6884526E822190204fe7279ee1db34Abd6` (its router is the retired router) |
| Fusion settlement | `0xD0F10948E5E987d9A04aDf4014178D65042f672c` |
| UniswapX settlement | `0xEA8fE55Ae47f334c6594a3fd57Dc6952b7F8cC33` |

### 2.1 Pools

| Pool | Key | Use |
|---|---|---|
| Hook pool | `(WETH, USDC, fee 3000, tickSpacing 60, hooks = Hook)` | Position accounting |
| Standard pool | `(WETH, USDC, fee 500, tickSpacing 10, hooks = 0)` | Physical fill (deepest, no hook) |

WETH (`0x4200…06`) sorts below USDC (`0x8335…13`), so WETH is `currency0`.

---

## 3. CoW Swap integration (`EswapCoWSettlement`)

### 3.1 The signed order

The trader signs a normal CoW order under the real GPv2 domain (name
`Gnosis Protocol`, version `v2`, chain 8453, verifying contract `0x9008…ab41`):

| Field | Required value |
|---|---|
| `kind` | `sell` (`keccak256("sell")`) |
| `partiallyFillable` | `false` |
| `feeAmount` | `0` |
| `sellTokenBalance`, `buyTokenBalance` | `erc20` (`keccak256("erc20")`) |
| `sellToken` / `buyToken` | USDC or WETH, one each way |
| `receiver` | `0x0` (same as owner) |
| `appData` | `keccak256(bytes(appDataJson(L)))` for the leverage `L` |

Signing schemes accepted: EIP-712, eth_sign, EIP-1271 (smart-contract wallets),
and pre-sign.

### 3.2 The canonical `appData` leverage commitment

The trader's order must commit to the leverage that will be filled. The exact
document is:

```
{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"<L>"}}
```

Its hash is the order's `appData`. `EswapCoWSettlement.appDataJson(5)` returns
this string byte for byte (checked on chain). The document must be registered
with the order book (`PUT /app_data/{hash}`) before the order is submitted.

The settlement requires `order.appData == keccak256(bytes(appDataJson(params.leverage)))`.
**The solver cannot choose a different leverage.** A mismatch reverts with
`LeverageCommitmentMismatch` (AUDIT CRIT-05).

### 3.3 `fillOrder` and `fillOrders`

```solidity
function fillOrder(CowOrder.Data order, Scheme scheme, bytes signature, FillParams params) returns (address owner);
function fillOrders(CowOrder.Data[] orders, Scheme[] schemes, bytes[] signatures, FillParams[] params) returns (uint256 count, uint256 failed);

struct FillParams { uint8 leverage; address solver; PoolKey key; PoolKey standardPoolKey; }
```

- **Calling convention.** `params.solver` must equal `msg.sender`. The settlement
  checks this (`SolverNotCaller`). The solver is also the address that pays the
  borrow leg, from its escrow.
- **Batching.** `fillOrders` binds each order's `params.solver` to the batch
  caller. Orders that fail are skipped and counted in `failed`, so one bad order
  cannot revert the batch (AUDIT HIGH-9).
- **Replay.** Each order's UID is `keccak256(digest ‖ owner ‖ validTo)`, and it is
  marked filled on the first fill.
- **Margin source.** The margin is pulled from the **order owner** when the owner
  has approved the settlement for at least `sellAmount`. Otherwise the settlement
  pulls it from the **solver**, which funds the trader's collateral. **Only fill an
  order whose owner allowance covers `sellAmount`, unless funding that margin is
  what you intend** (`EswapCoWSettlement._fillOrder`, lines 301-314).

### 3.4 The borrow leg: escrow, not a whitelist

The router only lets a solver borrow if it is governance-registered **or** holds a
pre-funded escrow for the borrow token (`erc20BorrowEscrow[solver][token]`) that
covers the whole borrow notional. The escrow route is the permissionless one. The
solver bonds in advance:

```solidity
router.depositBorrowEscrow(token, amount);   // pulls `amount` from the solver
```

On a fill, the borrow leg is drawn from the escrow. Escrow is the solver's own
capital, deposited by the solver. The protocol never supplies it. The solver can
withdraw unused escrow with `withdrawBorrowEscrow`.

---

## 4. Other fill paths

### 4.1 `EswapRouter.swapWithIntent`

A trader-signed `LendingIntent` (EIP-712, domain `EswapRouter`) can be relayed by
the solver the intent names, with the solver calling the router directly. The
signed intent pins the pool, direction, margin, leverage, solver, and slippage
floor. A solver can relay only what the trader signed.

Borrow funding has two rules, both covered by the fork test:

- A **governance-registered** solver calling the router itself has its borrow
  drawn from its wallet (`transferFrom(solver)`), with no escrow needed.
- An **unregistered** solver, or any relayer naming it, must be fully bonded in
  escrow. Otherwise the router reverts with `SolverNotAuthorized`.

So the signed intent does not, on its own, make a solver permissionless. The
registration gate still governs the wallet draw. The permissionless route is the
escrow route (§3.4).

### 4.2 `EswapSettlement` (generic, ERC-7683 origin data)

`EswapSettlement.fill(orderId, originData, fillerData)` is permissionless. The
filler fronts `notional` and is recorded as the position's `positionSolver`. The
filler recovers its principal and yield through `claimRepayment` after the
position closes. Verify `originData` against the origin contract before filling.

### 4.3 UniswapX and 1inch Fusion are **not** open to external solvers

Both settlements check `msg.sender == operator` before filling:

- `EswapUniswapXSettlement.fill` reverts `NotAuthorizedFiller` unless the caller is
  the operator.
- `EswapOneInchFusionSettlement.fill` reverts `NotOperator`.

On the live stack, both `operator()` values are `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037`,
which is **Eswap's own solver EOA**. An external resolver cannot fill these
orders today. Opening them to external resolvers would need a governance change
to the operator, which is a separate decision and is not in this release.

---

## 5. Minimal solver example (TypeScript, ethers v6)

This example bonds escrow, checks the owner's approval, and fills one CoW order
with the solver's own capital. It runs against Base (`BASE_RPC_URL`). It never
funds the trader's margin from the solver.

```ts
import { ethers } from "ethers";

const CHAIN_ID = 8453;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";
const ROUTER = "0x5b226aE5158de86f1E616875dBab886870B9aAd9";
const COW_SETTLEMENT = "0x7341859C0D7e039118b3f85F341583EBCDB8c960";
const HOOK = "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8";

const ROUTER_ABI = [
  "function depositBorrowEscrow(address token, uint256 amount)",
  "function erc20BorrowEscrow(address solver, address token) view returns (uint256)",
];
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
];
const SETTLEMENT_ABI = [
  "function fillOrder((address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance) order, uint8 scheme, bytes signature, (uint8 leverage,address solver,(address,address,uint24,int24,address) key,(address,address,uint24,int24,address) standardPoolKey) params) returns (address owner)",
  "function verify((address sellToken,address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,bytes32 kind,bool partiallyFillable,bytes32 sellTokenBalance,bytes32 buyTokenBalance) order, uint8 scheme, bytes signature) view returns (address owner, bytes32 orderDigest, bytes orderUid)",
];

const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL ?? "https://mainnet.base.org");
const solver = new ethers.Wallet(process.env.SOLVER_PRIVATE_KEY!, provider);

/** `intent` is one signed order from the Eswap intent feed. */
export async function fillIntent(intent: {
  order: Record<string, string | number | boolean>;
  scheme: number; // 0 = EIP-712
  signature: string;
}) {
  const raw = intent.order;
  // The contract takes `kind` and the balance markers as bytes32 hashes.
  const o = {
    sellToken: ethers.getAddress(String(raw.sellToken)),
    buyToken: ethers.getAddress(String(raw.buyToken)),
    receiver: ethers.getAddress(String(raw.receiver)),
    sellAmount: BigInt(String(raw.sellAmount)),
    buyAmount: BigInt(String(raw.buyAmount)),
    validTo: Number(raw.validTo),
    appData: String(raw.appData),
    feeAmount: 0n,
    kind: ethers.id("sell"),
    partiallyFillable: false,
    sellTokenBalance: ethers.id("erc20"),
    buyTokenBalance: ethers.id("erc20"),
  };
  const sellToken = o.sellToken;
  const sellAmount = o.sellAmount;

  // 1. Leverage comes from the trader's signed appData, not from the solver.
  let leverage = 0;
  for (let l = 2; l <= 5; l++) {
    const doc = `{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"${l}"}}`;
    if (ethers.keccak256(ethers.toUtf8Bytes(doc)) === o.appData.toLowerCase()) leverage = l;
  }
  if (leverage === 0) throw new Error("appData commits to no supported leverage");

  // 2. Never fund the trader's margin. The owner must have approved the settlement.
  const settlement = new ethers.Contract(COW_SETTLEMENT, SETTLEMENT_ABI, solver);
  const [owner] = await settlement.verify(o, intent.scheme, intent.signature);
  const token = new ethers.Contract(sellToken, ERC20_ABI, provider);
  if ((await token.allowance(owner, COW_SETTLEMENT)) < sellAmount) {
    throw new Error("owner has not approved the settlement for sellAmount; skipping");
  }

  // 3. Bond the borrow leg from the solver's own wallet, if not already bonded.
  const borrow = sellAmount * BigInt(leverage - 1);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, solver);
  const bonded = (await router.erc20BorrowEscrow(solver.address, sellToken)) as bigint;
  if (bonded < borrow) {
    const need = borrow - bonded;
    await (await new ethers.Contract(sellToken, ERC20_ABI, solver).approve(ROUTER, need)).wait();
    await (await router.depositBorrowEscrow(sellToken, need)).wait();
  }

  // 4. Fill. `solver` in params must be msg.sender.
  const key = [WETH, USDC, 3000, 60, HOOK];
  const standardKey = [WETH, USDC, 500, 10, ethers.ZeroAddress];
  const tx = await settlement.fillOrder(o, intent.scheme, intent.signature, {
    leverage,
    solver: solver.address,
    key,
    standardPoolKey: standardKey,
  });
  return (await tx.wait())?.hash;
}
```

Run a dry check first. Call `verify` and `staticCall` against `fillOrder` before
sending anything. `scripts/solvers/cowSolverBot.ts --dry-run` does exactly that.

---

## 6. Solver bot (`scripts/solvers/cowSolverBot.ts`)

The bot in this repository:

- polls the intent relay (`INTENT_FEED_URL`, default `http://127.0.0.1:8787/intents?status=open`),
  or reads `--orders <file>`, or a generated `--demo` intent;
- verifies each signature on chain, recovers the leverage from the appData, and
  rejects filled or expired orders;
- rejects any order whose owner has not approved the settlement for `sellAmount`.
  Without that approval the settlement would pull the margin from the solver, so
  the bot never fills such an order;
- reports the escrow shortfall for each intent (the bond the solver must post);
- simulates `fillOrder` from the solver's address. It sends only in live mode, and
  after a fill it reports the transaction back to the relay.

Dry run on a generated demo intent (no transactions):

```
node node_modules/tsx/dist/cli.mjs scripts/solvers/cowSolverBot.ts --demo --dry-run
```

The demo wallet has not approved the settlement, so the bot reports:

```
#0   rejected  lev=-  owner=-  (owner has not approved the settlement for sellAmount)
```

That is the safety rule working. For the escrow-shortfall view, pass a funded
trader's signed order with `--orders`. The output then reads
`needs-escrow … (bond 4000.0 USDC first)`, which is the zero-treasury model in
practice: the solver must bond its own 4,000 USDC before a fill clears.

### 6.1 The intent relay (`scripts/server/intentRelay.ts`)

The relay is the open board that replaces CoW's restricted auction. It holds no
funds and submits no transactions.

| Endpoint | Purpose |
|---|---|
| `POST /intents` | Submit `{order, scheme, signature}`. Verified on chain before listing (201 new, 200 duplicate, 400 invalid, 502 RPC failure) |
| `GET /intents?status=open` | Open, unexpired, unfilled intents for solvers |
| `GET /intents/:id` | One intent. `:id` is the on-chain order-UID hash |
| `POST /intents/:id/filled` | `{txHash?}`. Accepted only if `filledOrders(id)` is true on chain (409 otherwise) |

Run it with `node node_modules/tsx/dist/cli.mjs scripts/server/intentRelay.ts`
(port 8787 by default). Its self-check is `scripts/test/intentRelay.check.ts`.
The check runs 10 rejection paths against any RPC. With
`RELAY_CHECK_TRADER_KEY` set to a trader who has approved the settlement, it also
runs the listing path: a funded intent is listed, a duplicate returns 200, the
feed shows it, and a fill before settlement is rejected with 409. That path
passed 15/15 on a local Base fork.

**Order discovery.** CoW's auction endpoint (`api.cow.fi/base/api/v1/auction`)
returned `403` to an unauthenticated client, so solver-competition access is
restricted. Eswap does not depend on it. Intents reach solvers through the relay.
Traders must register the canonical `appData` document with the relay's order
book before they submit.

---

## 7. Status and open items

| Item | Status |
|---|---|
| Live contracts on Base | ✅ Deployed, checked on chain (§2) |
| CoW fill path, leverage commitment, escrow, senior claim | ✅ Implemented; fork test passing 2/2 (`ExternalSolverZeroTreasury.t.sol`, 2026-11-13). The test stands up its own hook/router on the real Base PoolManager with test-owned LP, so it proves the mechanism, not the live pool's state |
| UniswapX / Fusion for external resolvers | ❌ Operator-gated (§4.3). Not open |
| Intent relay (open feed for solvers) | ✅ Implemented and self-checked (`scripts/server/intentRelay.ts`). It is not hosted yet |
| `swapWithIntent` path | ✅ Covered by the fork test (3/3). The registered solver's borrow is drawn from its wallet, the replay (trader, nonce) is rejected, and the solver recovers principal plus yield on close |
| An external solver bonded and filling on mainnet | ❌ None yet |
| Live fill through the relay → bot → settlement loop | ⚠️ Not completed on the fork. The hook's TWAP circuit breaker (`TwapManipulated`, `EswapMarginLib`) blocked the fill in the fork's pool state. The guard is working as designed |
| Insurance fund backstop size | ⚠️ Read on chain; not guaranteed beyond the fund balance |
| Solver APY | ⚠️ No figure promised; depends on realised volume |

Reference tests: `src/v4/test/ExternalSolverZeroTreasury.t.sol` (fork, 3 tests:
CoW escrow path, `swapWithIntent` wallet path, and no-escrow-no-fill),
`scripts/test/intentRelay.check.ts` (relay), `test/ZeroTreasuryInvariants.t.sol`
(invariants, including solver-debt externality), and
`src/v4/test/EswapCoWSettlementTest.t.sol` (CoW semantics).
