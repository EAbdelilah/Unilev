# Eswap × Contango — Integration Specification (Base mainnet, chainId 8453)

**Date:** 2026-11-18
**Scope:** How a Contango-style cPerp venue can quote and route Eswap's fixed-5x, 0% interest long positions on Base: normalized quote shape, exact router calldata, carry comparison, and solver repayment.
**Status:** Specification against live Base contracts. The quoting/adapters exist in this repository; **no live Contango listing of Eswap exists yet**.
**Chain:** Base mainnet (chainId `8453`).

---

## 1. Summary

Eswap is a Uniswap v4 margin layer. A trader posts margin `M`; a JIT solver funds the `4 × M` borrow leg; the position is a 5x long with **0.00% borrow interest**. There is no protocol TVL and no CAC for the borrow leg: the capital is supplied per-trade by an external solver, escrowed on-chain, and repaid from the unwind proceeds.

For Contango this means Eswap can be presented as a **cPerp-like venue with no money-market position**: the quote is a leveraged long, the executed call is a single `EswapRouter.swapMultiPool(...)`, and the carry line item is zero by construction rather than by subsidy.

| Property | Value |
|---|---|
| Leverage | Fixed `5` (no 2x/3x/10x menu on the router) |
| Borrow interest / funding rate | `0.00%` (no accruing debt balance) |
| Protocol capital | `0` TVL for borrow; JIT solver capital only |
| Open fee | `10 bps` on the bought (base-token) leg |
| Borrow source | JIT solver, `4 × margin`, escrowed via `depositBorrowEscrow` |
| Solver return | Senior principal repayment + `100%` of rehypothecation yield |
| Long-only in this spec | `side = "long"`, `hookData = "0x"` on direct router calls |

---

## 2. Verified Base mainnet addresses

All addresses below are the live 8453 deployment. Do not substitute addresses from older (Unichain or 2026-10-20) deployments.

| Role | Address | Note |
|---|---|---|
| `EswapMarginHook` | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` | Position accounting, fee, solver debt |
| `EswapRouter` | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` | `swapMultiPool`, escrow, close/liquidate |
| `EswapRouterExt` | `0x907CdA8c588c9C859A6fB4F105593a64599741CB` | Trigger orders (automation only) |
| Uniswap v4 `PoolManager` | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | Canonical Base |
| `EswapSettlement` (ERC-7683) | `0x6F347acB3bD901731e192d482b7a40c50f30FCa1` | Optional fill path |
| CoW settlement | `0x7341859C0D7e039118b3f85F341583EBCDB8c960` | Optional solver rail |
| `PriceFeed` | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` | 18-decimal USD oracle |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 decimals |
| WETH | `0x4200000000000000000000000000000000000006` | 18 decimals |
| cbBTC | `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` | 8 decimals |

---

## 3. Pools, currency order, and direction

| Pool | Fee | Tick spacing | Hooks | Role |
|---|---:|---:|---|---|
| Hook pool | `3000` | `60` | `EswapMarginHook` | Position accounting, flash borrow |
| Standard fill pool | `500` | `10` | `0x000…000` | Physical execution from real v4 liquidity |

Uniswap v4 sorts currencies by ascending address:

| Pair | `currency0` | `currency1` | `zeroForOne` for USDC-in long |
|---|---|---|---|
| WETH/USDC | WETH (`0x4200…06`) | USDC (`0x8335…13`) | `false` |
| cbBTC/USDC | USDC (`0x8335…13`) | cbBTC (`0xcbB7…Bf`) | `true` |

**Liveness gate (2026-11-18):** WETH/USDC is fully live. cbBTC/USDC **phase 1** is live (pools initialized, oracle/adapter/quoter/queue wired), but the queued hook registration executes only at ETA `1795195136` = `2026-11-20 17:18:56 UTC`. Until then cbBTC quotes return `QUOTE_FAILED`; Contango must not list or route that pair before phase 2.

---

## 4. Exact router calldata encoding (viem)

`swapMultiPool` takes **one tuple**. `amountSpecified` is the **negative margin** (negative = exact input). `hookData` is empty on the direct router path. The selector for `swapMultiPool(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256))` is `0x33046e31`.

```solidity
// EswapRouter.sol (Base 8453) — canonical surfaces
function swapMultiPool(SwapParams calldata params) external payable returns (bytes memory);
function depositBorrowEscrow(address token, uint256 amount) external;
// SwapParams = (key, standardPoolKey, zeroForOne, amountSpecified,
//               leverage, solver, hookData, deadline, minAmountOut)
```

```ts
import { encodeAbiParameters, encodeFunctionData, parseAbi, type Address, type Hex } from "viem"

const ROUTER = "0x5b226aE5158de86f1E616875dBab886870B9aAd9" as const
const HOOK = "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8" as const
const WETH = "0x4200000000000000000000000000000000000006" as const
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const
const ZERO = "0x0000000000000000000000000000000000000000" as const

const ROUTER_ABI = parseAbi([
    // Canonical signature (selector 0x33046e31):
    // swapMultiPool(((address,address,uint24,int24,address),(address,address,uint24,int24,address),bool,int256,uint8,address,bytes,uint256,uint256))
    "function swapMultiPool((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) standardPoolKey,bool zeroForOne,int256 amountSpecified,uint8 leverage,address solver,bytes hookData,uint256 deadline,uint256 minAmountOut) params) payable returns (bytes)",
])

// WETH/USDC long. For cbBTC/USDC swap the key currencies and set zeroForOne = true.
const params = {
    key: { currency0: WETH, currency1: USDC, fee: 3000, tickSpacing: 60, hooks: HOOK },
    standardPoolKey: { currency0: WETH, currency1: USDC, fee: 500, tickSpacing: 10, hooks: ZERO },
    zeroForOne: false,                 // USDC (currency1) in, WETH (currency0) out
    amountSpecified: -1_000_000_000n,  // -1,000 USDC margin, exact input
    leverage: 5,                       // fixed; borrow leg = 4,000 USDC
    solver,                            // JIT solver address, must be non-zero
    hookData: "0x",                    // direct router path; NOT the settlement form
    deadline: BigInt(nowSeconds + 900),
    minAmountOut: 1_649_340_000_000_000_000n, // quote × (1 − slippageBps/10000)
} as const

const calldata: Hex = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapMultiPool",
    args: [params],
})
// transaction: { to: ROUTER, data: calldata, value: 0n }
```

Invariants a listing must enforce before signing/routing:

1. `leverage === 5` and `solver !== address(0)`.
2. `amountSpecified < 0` and `abs(amountSpecified)` equals the margin the user approved to the router.
3. `key.hooks === HOOK`, `standardPoolKey.hooks === ZERO`, and both keys carry the same two currencies.
4. `deadline` in the future and `minAmountOut` derived from a **fresh** quote, never a cached one.
5. For cbBTC/USDC, fail closed with `QUOTE_FAILED` until the registration ETA has passed.

---

## 5. Normalized quote object shape

Contango receives a cPerp-style quote. All token amounts are minimized integer strings; USD values are 6-decimal strings; `moneyMarket` is explicitly `"none"` so no downstream module tries to open an Aave/Morpho debt position.

```ts
export interface ContangoNormalizedQuote {
    protocol: "eswap"
    venue: "uniswap-v4-hook"
    moneyMarket: "none"                 // no money-market leg is created
    pair: "WETH/USDC" | "cbBTC/USDC"
    side: "long"
    leverage: 5
    tokenIn: Address                    // USDC
    tokenOut: Address                   // WETH or cbBTC
    tokenOutDecimals: number            // 18 or 8
    collateralUsdcUnits: string         // 6dp, e.g. "1000000000"
    borrowUsdcUnits: string             // 4 × collateral
    notionalUsdcUnits: string           // 5 × collateral
    grossOutputUnits: string            // before 10 bps fee
    protocolFeeUnits: string            // gross × 10 / 10000
    netOutputUnits: string              // gross − fee
    benchmarkBorrowAprBps: number       // e.g. 1200 (live rate preferred)
    eswapBorrowAprBps: 0                // literal zero
    dailyBorrowInterestSavedUsdc: string
    annualBorrowInterestSavedUsdc: string
    minAmountOut: string
    deadline: string
    deadlineSeconds: number
    call: { to: Address; data: Hex; value: bigint }
}
```

Illustrative WETH/USDC payload (values are examples, not a live quote):

```json
{
  "protocol": "eswap",
  "venue": "uniswap-v4-hook",
  "moneyMarket": "none",
  "pair": "WETH/USDC",
  "side": "long",
  "leverage": 5,
  "tokenIn": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "tokenOut": "0x4200000000000000000000000000000000000006",
  "tokenOutDecimals": 18,
  "collateralUsdcUnits": "1000000000",
  "borrowUsdcUnits": "4000000000",
  "notionalUsdcUnits": "5000000000",
  "grossOutputUnits": "1666000000000000000",
  "protocolFeeUnits": "1666000000000000",
  "netOutputUnits": "1664334000000000000",
  "benchmarkBorrowAprBps": 1200,
  "eswapBorrowAprBps": 0,
  "dailyBorrowInterestSavedUsdc": "1.315068",
  "annualBorrowInterestSavedUsdc": "480.000000",
  "minAmountOut": "1649340000000000000",
  "deadlineSeconds": 900,
  "call": { "to": "0x5b226aE5158de86f1E616875dBab886870B9aAd9", "value": "0" }
}
```

---

## 6. 0% vs Aave/Morpho: the comparison formula

Use simple interest on the **borrow leg only**, with the same formula for every venue:

```
interestUnits = borrowUnits × aprBps × days / (10_000 × 365)
```

```ts
export function carryInterestUnits(borrowUnits: bigint, aprBps: number, days: number): bigint {
    return (borrowUnits * BigInt(aprBps) * BigInt(days)) / (10_000n * 365n)
}
// Eswap: aprBps = 0 -> 0 for every horizon.
```

Worked example, `1,000 USDC` margin, `4,000 USDC` borrow, benchmark `1,200 bps` (12%):

| Horizon | Aave/Morpho @ 12% (USDC) | Eswap @ 0% | Saved |
|---|---:|---:|---:|
| 1 day | 1.315068 | 0.000000 | 1.315068 |
| 7 days | 9.205479 | 0.000000 | 9.205479 |
| 30 days | 39.452054 | 0.000000 | 39.452054 |
| 365 days | 480.000000 | 0.000000 | 480.000000 |

Governance rule: `benchmarkBorrowAprBps` must come from a live rate reader (inject `getBorrowAprBps()`), not a hardcoded constant. The `1200` value above is a **benchmark**, not a claim about a specific Aave/Morpho pool at quote time. The comparison excludes swap fees, slippage, and the 10 bps open fee, which apply to both venues.

---

## 7. Senior solver repayment logic

1. The solver bonds `borrow = 4 × margin` via `EswapRouter.depositBorrowEscrow(token, amount)` (or is governance-registered). The router never draws borrow capital from protocol treasury.
2. `swapMultiPool` flash-expands the margin inside one `PoolManager.unlock`; the physical fill executes in the 500/10 no-hook pool; the hook registers the position and the `positionSolver`.
3. At close/rebalance/liquidation the unwind proceeds repay the solver's **senior principal first**, then distribute `100%` of realized rehypothecation LP yield to the recorded `positionSolver`; residual value goes to the trader.
4. "Senior" is a waterfall position, not a guarantee: if unwind proceeds are insufficient, the solver can still take a loss. Solvers must underwrite slippage and market risk.

Optional cross-chain fill path (`EswapSettlement.fill`) uses a different hookData form:

```ts
// Types exported by agent-integrations/core/src/calldata.ts:
// SETTLEMENT_TYPES = [PoolKey, PoolKey, bool, int256, uint8, address, bytes, uint256]
// HOOK_DATA_TYPES  = [bool isLong, uint8 leverage, address recipient]
// NOTE: no deadline field; the settlement supplies block.timestamp + DEFAULT_DEADLINE_SLACK.
const hookData = encodeAbiParameters(HOOK_DATA_TYPES, [true, 5, recipient])
const originData = encodeAbiParameters(SETTLEMENT_TYPES,
    [key, standardPoolKey, zeroForOne, -marginUnits, 5, ignoredSolver, hookData, minAmountOut])
// EswapSettlement.fill(orderId, originData, fillerData); selector 0x82e2c43f
```

The `solver` field in `originData` is **overwritten** by the settlement with the settlement address; `hookData` must be `abi.encode(true, leverage, recipient)` or the fill reverts.

---

## 8. What is NOT claimed

- **No live Contango listing.** Eswap is not listed on Contango; this is a technical specification, not an announcement of a partnership, audit, or listing decision.
- **No Aave/Morpho deposit is made.** Eswap does not borrow from a money market; the 12% figures are a benchmark comparison only.
- **No guaranteed solver APY or yield.** Rehypothecation yield is realized at unwind and depends on volume; no APY is promised to solvers or traders.
- **No zero-risk senior claim.** Senior repayment is a waterfall; shortfalls can leave the solver with a loss.
- **No cbBTC tradability before phase 2.** Until `1795195136`, cbBTC/USDC returns `QUOTE_FAILED` and must not be quoted or routed.
- **No off-chain custody or relayer trust assumption in the listing path.** The direct `swapMultiPool` call is atomic on Base; the ERC-7683 path is optional and separate.

---

## 9. Reference implementation

`agent-integrations/core/src/adapters/contangoAdapter.ts` (`buildContangoQuote`, `createContangoAdapter`), `quote.ts` (`carryInterestUnits`, `buildSwapParams`), `calldata.ts` (`encodeSwapMultiPool`, `encodeSettlementOriginData`), `constants.ts` (addresses, pool keys, `LEVERAGE = 5`), and `docs/SOLVER_INTEGRATION_GUIDE.md` (solver economics and waterfall).
