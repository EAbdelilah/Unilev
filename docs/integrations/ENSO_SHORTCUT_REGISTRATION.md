# Eswap Enso Shortcut Registration (Base mainnet, chainId 8453)

**Date:** 2026-11-18
**Scope:** PR-ready descriptor, calldata chain, and registration checklist for exposing Eswap's fixed-5x leveraged open as an Enso Shortcut.
**Status:** Implementation and descriptors exist in this repository; Eswap is **not yet an official listed Enso action provider**.
**Chain:** Base mainnet (chainId `8453`).

---

## 1. Why this is a selector-based integration

Enso Shortcuts route by **function selector**: a descriptor declares a `target` address, a `selector`, and an ordered `calls` chain executed atomically in one transaction. Eswap maps cleanly because the terminal call is a single stable selector on the live core router.

| Item | Value |
|---|---|
| Route endpoint | `POST https://api.enso.finance/api/v1/shortcuts/route` |
| Config/registration endpoint (SDK path) | `POST https://api.enso.finance/config/shortcuts` |
| Connector | `eswap` |
| Target | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` (`EswapRouter`) |
| Routed selector | `0x33046e31` = `swapMultiPool(...)` |
| Chain | Base `8453` |
| Leverage | Fixed `5` only; other leverage values are rejected |

The borrow leg is **not** an approval from the trader. The JIT solver bonds `4 × margin` in router escrow; the router pulls the margin from the trader and the borrow from the solver inside one `PoolManager.unlock`. A shortcut that approves the borrow from the trader is incorrect and must be rejected in review.

---

## 2. Descriptor JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "EswapEnsoShortcutDescriptor",
  "type": "object",
  "required": ["name", "description", "chainId", "connector", "selector", "target", "calls", "valueBps", "gasReserve", "tokens"],
  "properties": {
    "name": { "type": "string", "pattern": "^eswap-5x-" },
    "description": { "type": "string", "minLength": 1 },
    "chainId": { "const": 8453 },
    "connector": { "const": "eswap" },
    "selector": { "const": "0x33046e31" },
    "target": { "const": "0x5b226aE5158de86f1E616875dBab886870B9aAd9" },
    "calls": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["to", "data"],
        "properties": {
          "to": { "type": "string", "pattern": "^0x[0-9a-fA-F]{40}$" },
          "data": { "type": "string", "pattern": "^0x([0-9a-fA-F]{2})*$" },
          "value": { "type": "string", "description": "decimal wei; omit when zero" },
          "label": { "type": "string" }
        },
        "additionalProperties": false
      }
    },
    "valueBps": { "type": "integer", "minimum": 0, "maximum": 10000 },
    "gasReserve": { "type": "string", "pattern": "^[0-9]+$" },
    "tokens": {
      "type": "array",
      "minItems": 2,
      "items": { "type": "string", "pattern": "^0x[0-9a-fA-F]{40}$" }
    }
  },
  "additionalProperties": false
}
```

### 2.1 Concrete descriptor (WETH/USDC, 1,000 USDC margin)

```json
{
  "name": "eswap-5x-WETH-USDC",
  "description": "Atomic 5x WETH/USDC margin open on Eswap (Uniswap v4, Base 8453). 0.00% borrow interest vs Aave/Morpho; no flashloan loop. JIT solver bonds the 4x borrow leg and receives senior repayment + LP yield.",
  "chainId": 8453,
  "connector": "eswap",
  "selector": "0x33046e31",
  "target": "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
  "calls": [
    {
      "to": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "data": "0x095ea7b3<approve router for 1000000000 USDC units>",
      "label": "approve USDC margin to EswapRouter"
    },
    {
      "to": "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
      "data": "0x<depositBorrowEscrow(USDC, 4000000000)>",
      "label": "bond 4x borrow leg in EswapRouter escrow"
    },
    {
      "to": "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
      "data": "0x33046e31<encoded SwapParams tuple>",
      "label": "swapMultiPool: atomic 5x open"
    }
  ],
  "valueBps": 30,
  "gasReserve": "900000",
  "tokens": [
    "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "0x4200000000000000000000000000000000000006"
  ]
}
```

`<placeholder>` segments above are byte templates: generate the full hex with `buildEnsoShortcut`/`buildEnsoRouteRequest` in `agent-integrations/core/src/adapters/ensoAdapter.ts`. Do not paste a placeholder into a live request.

---

## 3. The three-call chain

| # | Call | Conditional? | Debits | Purpose |
|---|---|---|---|---|
| 1 | `USDC.approve(router, margin)` | Yes — omit when `allowance(owner, router) >= margin` | Trader (margin only) | Lets the router pull exactly the margin |
| 2 | `router.depositBorrowEscrow(USDC, missingBorrow)` | Yes — omit when solver escrow already covers `4 × margin` | Solver | Bonds the borrow leg |
| 3 | `router.swapMultiPool(params)` | No — terminal call | Trader margin + solver borrow | Atomic 5x open |

Rules enforced by `buildEnsoShortcut`:

- `leverage` must be `5`; `quoteOutputUnits > 0`; `valueBps` in `[0, 10000]`; `gasReserve > 0`.
- Approval amount is the **margin**, never the notional and never the borrow.
- `skipApproval` / `skipEscrow` are only for callers that have verified allowance/escrow on chain in the same block context.
- cbBTC/USDC must not be registered until after hook registration ETA `1795195136` (`2026-11-20 17:18:56 UTC`); before that the quoter returns `QUOTE_FAILED`.

---

## 4. Building the calls (viem)

```ts
import { encodeFunctionData } from "viem"

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const
const ROUTER = "0x5b226aE5158de86f1E616875dBab886870B9aAd9" as const

const approve = encodeFunctionData({
    abi: [{ type: "function", name: "approve", stateMutability: "nonpayable",
            inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
            outputs: [{ type: "bool" }] }] as const,
    functionName: "approve",
    args: [ROUTER, 1_000_000_000n],            // 1,000 USDC, 6dp
})

const depositBorrowEscrow = encodeFunctionData({
    abi: [{ type: "function", name: "depositBorrowEscrow", stateMutability: "nonpayable",
            inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
            outputs: [] }] as const,
    functionName: "depositBorrowEscrow",
    args: [USDC, 4_000_000_000n],              // 4x margin; solver-funded
})

// Terminal call: one SwapParams tuple, amountSpecified = -margin, leverage = 5.
const swapMultiPool = encodeSwapMultiPool(params)  // selector 0x33046e31
```

`SwapParams` tuple (in order): `(PoolKey key, PoolKey standardPoolKey, bool zeroForOne, int256 amountSpecified, uint8 leverage, address solver, bytes hookData, uint256 deadline, uint256 minAmountOut)`. For WETH/USDC use `zeroForOne = false`; for cbBTC/USDC use `zeroForOne = true`. Direct router `hookData` is `"0x"`.

---

## 5. Route request body

```json
{
  "chainId": 8453,
  "connector": "eswap",
  "target": "0x5b226aE5158de86f1E616875dBab886870B9aAd9",
  "selector": "0x33046e31",
  "fromToken": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "toToken": "0x4200000000000000000000000000000000000006",
  "amountIn": "1000000000",
  "minAmountOut": "1649340000000000000",
  "deadline": "1794000000",
  "leverage": 5,
  "calls": [],
  "valueBps": 30,
  "gasReserve": "900000",
  "tokens": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "0x4200000000000000000000000000000000000006"],
  "description": "Atomic 5x WETH/USDC margin open on Eswap; 0.00% borrow interest."
}
```

`calls` is filled with the three encoded calls from §4. `deadline` and `minAmountOut` must be recomputed at request time; the values above are illustrative.

### 5.1 Ranking fields

| Field | Default | Policy |
|---|---:|---|
| `valueBps` | `30` | Honest estimate of route value, not a fabricated edge. Do not exceed a measured advantage; `0–10000` enforced. |
| `gasReserve` | `900000` | Reserve for the full chain (approve + escrow + open), in wei-equivalent units as a decimal string. |
| `tokens` | `[USDC, base]` | Approval-check set; includes every token the chain touches. |

---

## 6. Registration checklist

- [ ] Router, hook, PoolManager, price feed addresses match §1 exactly (Base 8453, no Unichain/retired addresses).
- [ ] `selector = 0x33046e31`, `target = EswapRouter`, `connector = "eswap"`, `chainId = 8453`.
- [ ] Descriptor validates against the JSON Schema in §2 (including `additionalProperties: false`).
- [ ] Call chain order verified: approval → escrow (if needed) → `swapMultiPool`.
- [ ] Approval equals margin only; no approval for the `4x` borrow leg.
- [ ] `amountSpecified` is negative and equal to the approved margin; `leverage = 5`; solver non-zero.
- [ ] `minAmountOut` derived from a fresh quote; `deadline` future; slippage bounded.
- [ ] WETH/USDC enabled. cbBTC/USDC **excluded** until after ETA `1795195136`.
- [ ] `valueBps`/`gasReserve` justified by a measurement, not a guess.
- [ ] Simulate the full bundle on a Base fork before requesting listing; confirm position credited to the user, not the router.
- [ ] Sourcify/explorer verification links attached for router and hook.
- [ ] "What is NOT claimed" section included in the PR description verbatim.

---

## 7. PR-ready submission copy

> **Add Eswap as an Enso connector (Base 8453).** Eswap is a Uniswap v4 margin venue with fixed 5x leverage and 0.00% borrow interest. A shortcut is a three-call chain: conditional USDC margin approval, conditional solver borrow-escrow top-up, then `EswapRouter.swapMultiPool` (`0x33046e31`). The borrow leg is JIT-funded by an external solver (4x margin) and is never approved from the trader; the solver receives senior principal repayment and 100% of rehypothecation LP yield. The protocol holds zero borrow TVL and charges 10 bps on the bought leg. WETH/USDC is live; cbBTC/USDC is phase 1 only and excluded until the hook registration ETA. Descriptor, schema, and checklist: `docs/integrations/ENSO_SHORTCUT_REGISTRATION.md`; builder: `agent-integrations/core/src/adapters/ensoAdapter.ts`.

| Review fact | Answer |
|---|---|
| New money-market debt? | No; `moneyMarket: none` |
| Trader approves borrow? | No; margin only |
| Protocol TVL required? | Zero |
| Leverage options | Fixed 5x |
| Live pairs at PR time | WETH/USDC only |

---

## 8. Failure modes (fail closed)

| Condition | Required behavior |
|---|---|
| `leverage !== 5` | Reject descriptor at build time (`UNSUPPORTED_LEVERAGE`) |
| `quoteOutputUnits <= 0` or `QUOTE_FAILED` | Reject; do not build `calls` |
| Stale `deadline` / weak `minAmountOut` | Recompute from fresh quote |
| cbBTC before `1795195136` | Exclude pair entirely |
| Solver escrow short and `skipEscrow` set | Reject unless escrow verified on chain |
| Approval for notional/borrow | Reject |

---

## 9. What is NOT claimed

- **Not yet an official listed Enso action provider.** This is a registration package, not an accepted listing, partnership, or endorsement by Enso.
- **No live shortcut has been registered from this repository.** The endpoint and schema are documented; no PR has been merged upstream.
- **No Enso SDK dependency is installed.** The descriptor is emitted as plain JSON so review can proceed with `viem` alone.
- **No borrow capital from the trader or protocol.** The 4x leg is always solver-bonded.
- **No cbBTC availability before phase 2.** Quote failures before ETA `1795195136` are expected and must be treated as a hard stop.
- **No guaranteed routing volume, inclusion, valueBps ranking, or solver APY.**
