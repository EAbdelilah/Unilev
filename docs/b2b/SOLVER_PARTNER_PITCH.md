# Eswap B2B — Solver Partner Pitch

**Chain:** Unichain Mainnet (chain ID `130`)
**Status:** pre-launch. Read "What we are not claiming" before you commit capital.

This is the counterpart to `docs/b2b/AGGREGATOR_SUBMISSION_PACK.md`. That
document is for venues routing *into* Eswap. This one is for partners who lend
capital *to* Eswap and want the leveraged borrow leg.

Machine-readable companions live in `integrations/solvers/`:

| File | Purpose |
|---|---|
| `shared.ts` | Escrow, debt-book and yield arithmetic |
| `cow/appData_schema.json` | CoW appData commitment metadata |
| `cow/fillCoWOrder.ts` | CoW order build, precheck, fill calldata |
| `uniswapx/fillUniswapXOrder.ts` | SignedOrder calldata + economics screen |
| `oneinch-fusion/fillFusionOrder.ts` | TakerTraits + post-interaction calldata |

`test/b2b_master_integration.test.ts` asserts the arithmetic below agrees with
the code, and that each venue's failure path fails closed.

---

## 1. What a solver actually does

When a trader opens a leveraged Eswap position, the size on the pool is
`margin × leverage`, but the trader only posts the margin. The difference is the
**borrowed leg**, and a solver supplies it:

```
margin M, leverage L
  notional          = M × L
  trader posts      = M
  solver supplies   = M × (L − 1)        <-- this is what you bond
```

The position then earns yield while it is open. On close, you are repaid
**principal plus accumulated yield**. Both numbers are public on chain.

## 2. You are paid, and you can check the books

`hook.solverDebts(poolId, trader, solver)` returns `(principal,
accumulatedYield)` for any trader and pool. There is no oracle, no Eswap-operated
accounting layer, and no reporting API in the middle. Read it directly:

```ts
import { readSolverBook, solverClient } from './integrations/solvers/shared.js'

const book = await readSolverBook(solverClient(process.env.UNICHAIN_RPC_URL!), {
  poolId: '0x4b830e9b09c2717fc198a556651bf2569eda7e57dcfb5b801db6e1c2eadf2591',
  trader: '0x…',
  solver: '0x518634753C61342298c3E04326056b3Ce596a566',
})
// book.totalPayout === book.principal + book.accumulatedYield
```

When you are asked "what is your APY basis?", that call is the answer. We would
rather you verify than trust a slide.

## 3. The economics you are underwriting

| Component | bps |
|---|---|
| Protocol toll | 10 |
| Flash premium on the fill | **0** |
| Round trip (open + close) | **30** |

`InventoryFlashProvider.flashLoan` hardcodes `feeAmounts[0] == 0`. The 30 bps
round trip is charged to the *trader*, not to you — you are paid on top of the
principal you return.

What you are exposed to is price risk, not fee drag: a leveraged position that
moves against the trader unwinds with `accumulatedYield` negative, and the
shortfall is what section 5 is about.

**Leverage bounds:** min 2, max 5 on the live hook. Read them on chain rather
than hardcoding; they are hook state, not immutable constants.

---

## 4. Venue integrations

### 4.1 CoW Protocol — `cow/fillCoWOrder.ts`

Settlement: `EswapCoWSettlement`, source-verified at
`src/v4/EswapCoWSettlement.sol`.

The interesting part is the underwriting control. The trader's signed order
carries `appData`, which must equal
`keccak256(abi.encodePacked(APP_DATA_LEVERAGE_TAG, leverage))`. The settlement
reverts `LeverageCommitmentMismatch` otherwise. So **the solver picks the
leverage it will fund, and the trader has already signed for exactly that
leverage.** A solver cannot quietly increase the exposure it is bonding.

> **Encoding trap, verified while building this package.** The Solidity is
> `abi.encodePacked(bytes32, uint8)` — a **33-byte** preimage, unpadded. Building
> it with viem's `encodeAbiParameters([{bytes32},{uint8}], …)` produces a
> **64-byte** padded preimage and a completely different hash. It compiles, it
> typechecks, it round-trips through your own precheck, and then **every single
> fill reverts** with `LeverageCommitmentMismatch`. The correct form is
> `keccak256(concatHex([TAG, toHex(Uint8Array.of(leverage))]))`. The harness
> asserts the exact hash and asserts that the padded form is *not* used, so this
> cannot regress silently.

The settlement also recovers the signer from the real CoW signature and credits
the position to that recovered owner, rather than trusting a caller-supplied
address.

### 4.2 UniswapX — `uniswapx/fillUniswapXOrder.ts`

`screenFillEconomics` **fails closed.** If the signed order carries no
`expectedYieldBps`, the precheck rejects it. Passing an unprofitable fill is not
possible by omission — you must assert a yield figure and have it beat the
round-trip cost.

This is deliberate. A solver integration that assumes yield is profitable by
default is a solver integration that discovers it is not during a volatile hour.

### 4.3 1inch Fusion — `oneinch-fusion/fillFusionOrder.ts`

Encodes `TakerTraits` with explicit byte offsets and rejects a
`postInteraction` whose declared length disagrees with its payload
(`interaction-length-mismatch`). Post-interaction data is integrator-supplied:
we have not guessed at a shape we cannot verify against a deployed contract.

---

## 5. What we are not claiming

This section exists because the failure modes below are real and we would rather
you price them than discover them.

### 5.1 Solver capital is priority, not guaranteed

On an unwind that proceeds less than the debt owed:

1. The insurance fund is drawn first, capped at the ERC-6909 claims it actually
   holds.
2. **The remainder is booked as `badDebt`. The transaction does not revert.**
3. The solver payout is truncated to available proceeds.

```
src/v4/EswapMarginHookLogic2.sol:490-497
  uint256 uncovered = shortfall - covered;
  if (uncovered > 0) badDebt[debtCurrency] += uncovered;
  uint256 solverPayout = totalPayout > payableAmount ? payableAmount : totalPayout;
```

This is a payment **priority**, not a guarantee. We will not describe it to you
as capital that is guaranteed by the smart contract, because it is not.

### 5.2 The keeper is deployed and covers nothing

`EswapLiquidationKeeper` is live at
`0x5E8aDA65050962c62A815932BF38dc144E0545DA` — 7,451 bytes of verified bytecode,
and it answers `watchesLength()`.

That function currently returns **`0`**.

No position is under automated liquidation. Adding coverage is owner-only via
`addWatch()`. A deployed keeper is not protection, and we will not let you read
one into the other.

### 5.3 No APY figure is offered

`accumulatedYield` is a **realised** number readable after the fact. It depends on
the LP band and the price path between open and close. We are not quoting a
forward yield, because we do not have one that survives contact with the next
drawdown.

### 5.4 No third-party audit is claimed

`docs/SECURITY_AUDIT_V4.md` is an internal review, not a published external
audit. Treat the code as unaudited until that changes.

### 5.5 The settlement contracts are not deployed

Every settlement address in `integrations/solvers/shared.ts` (`cow`,
`uniswapX`, `oneInchFusion`, `erc7683`) is a deliberate zero-address
placeholder. The contracts are implemented and unit-tested on a fork; the
encoders in this package are complete and conformance-tested. **None of it is
live.** We would rather ship an obviously-dead address than a plausible-looking
one.

---

## 6. Capital sizing

Given a collateral requirement you are willing to lose, the binding constraint is
not the borrow — it is the **uncovered** branch in 5.1.

- Size against the worst case you can survive, not the median.
- `borrowNotional(margin, leverage)` and `positionNotional(margin, leverage)`
  are exported from `shared.ts` so your sizing maths and our encoder cannot
  drift apart.
- **0% flash premium** (section 3) removes flash cost from the equation entirely.
  Your risk here is directional, not financing.

---

## 7. Before you commit capital

- [ ] Read `src/v4/EswapMarginHookLogic2.sol:490-497` yourself — do not take our
      summary of the bad-debt branch on trust
- [ ] Read a live `solverDebts` call for a position you have already closed
- [ ] Confirm `watchesLength()` for the pool you intend to lend into; if it is 0,
      ask us why before bonding
- [ ] Verify hook leverage bounds on chain rather than trusting section 3
- [ ] Treat every settlement address in this package as zero until we tell you
      otherwise in writing
- [ ] Re-measure gas. Our fork figures are ~1.19M for a leveraged round trip and
      they will drift on mainnet

## 8. Contact

Fill this in before sending: project website, contact email, named technical
owner for the solver book, and the address you will bond from.