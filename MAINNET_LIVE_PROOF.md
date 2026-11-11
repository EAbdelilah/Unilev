# Eswap v4 — Base Mainnet Live Proof (Broadcasted)

**Claim under test:** a leveraged position can be opened and closed end-to-end
on Base Mainnet with real signed transactions, with the borrow leg supplied by a
registered solver and the collateral deployed into a Uniswap V4 LP band.

**Status:** **PROVEN LIVE.** The full cycle (register pool → fund solver → open
→ close) was broadcast and confirmed on Base Mainnet (chain `8453`) on
2026-11-10. This is a real on-chain proof, not a fork simulation.

---

## 1. Live artifact summary

| Field | Value |
|---|---|
| Chain | Base Mainnet (`8453`) |
| Router | `0xD3360D67E366Cac21a1c18fC9100B93be79e1437` |
| Hook (accounting) | `0xe33A630503c640143126BBF222a82689D49b50c8` |
| Adapter | `0x14FBAF1858d37BF994BDAF9ab4b31A664D4663aD` |
| Hook pool id | `0xdd4958586bcbc340177b3b18ecbf31cfa277e5a8a78735deee01218f54a1d512` |
| Solver (registered) | `0x3fc88b834aC96Fa4c65913a6D3d5523418f7F037` |
| Owner / broadcaster | `0x518634753C61342298c3E04326056b3Ce596a566` |
| Trader / recipient | `0x518634753C61342298c3E04326056b3Ce596a566` |
| Margin / leverage / borrow | `10000000000000` wei WETH / `2x` / `10000000000000` wei WETH |
| Notional (USDC output) | `40810` wei USDC collateral |

---

## 2. Broadcasted transactions (Basescan)

| Step | Tx hash | Gas |
|---|---|---|
| `adapter.registerPool(WETH,USDC,3000,hookKey,stdKey)` | `0x0644d369404b02a0f5b7239f230f618f4911cfd2901d7c948fd76ade339019bd` | 43,798 |
| Fund solver WETH (pre-existing) | — | — |
| `adapter.exactInputSingleWithLeverage` (OPEN) | `0x05c843120aa01b51d10667cc84f8f774f6c78ecb7336569852a5abd73ba76d3a` | 1,138,521 |
| `router.closePosition` (CLOSE) | `0x6e0d18b0a0fa14af32bcbe10689bf1cc98f1428e08ea50b941af954ca6b25b5f` | 312,751 |

Basescan links:

- OPEN: https://basescan.org/tx/0x05c843120aa01b51d10667cc84f8f774f6c78ecb7336569852a5abd73ba76d3a
- CLOSE: https://basescan.org/tx/0x6e0d18b0a0fa14af32bcbe10689bf1cc98f1428e08ea50b941af954ca6b25b5f

---

## 3. What actually happened (flow)

```
owner  -> adapter.registerPool(WETH, USDC, 3000, hookKey, standardKey)
solver -> erc20BorrowEscrow (pre-funded WETH)
trader -> adapter.exactInputSingleWithLeverage
            -> EswapRouter.swapMultiPool
            -> standard pool swap WETH -> USDC
            -> EswapMarginHook accounting: position + solverDebt
            -> deployCollateral (80/90% into LP band)
trader -> EswapRouter.closePosition
            -> hook unwind -> solver repaid principal; trader gets residual
            -> position cleared
```

- The **borrowed leg was supplied by the solver**, not by protocol capital.
- The **collateral was deployed into a Uniswap V4 LP band** on open.
- The protocol **holds no WETH/USDC of its own** in the flow.

---

## 4. On-chain verification (read back from the chain)

**OPEN (`0x05c843120aa01…`)**
- `positions(hookPoolId, trader)`: trader `0x5186…`, collateral `40810`,
  borrowed `10000000000000`, leverage `2`.
- `solverDebts(hookPoolId, trader, solver)`: solver `0x3fc8…`, principal
  `10000000000000`.
- `positionSolver(hookPoolId, trader)` = `0x3fc8…`.

**CLOSE (`0x6e0d18b0a0fa14…`)**
- `positions(...).trader` after = `0x0000000000000000000000000000000000000000`
  (cleared).
- `collateral` after = `0`.
- `liquidity` after = `0`.

---

## 5. Real vs simulated

| Component | Status |
|---|---|
| Chain / block production | **REAL** — Base Mainnet |
| Transactions | **REAL** — broadcasted & mined (see hashes) |
| V4 `PoolManager` | **REAL** — canonical Base PM |
| Eswap adapter / router / hook | **REAL** — live deployed bytecode |
| Solver | **REAL** — registered via `router.setSolverWhitelist` |
| Notional size | small by design (micro trade) — proves flow, not size |

---

## 6. Reproduce

```bash
# open + close micro position (broadcast)
node scripts/v4/live-micro.cjs

# close an existing position
node scripts/v4/live-close.cjs
```

Artifact: `scripts/v4/live/proofs/full-cycle-live-micro.json`.