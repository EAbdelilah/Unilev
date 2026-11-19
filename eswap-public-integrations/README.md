<!-- SPDX-License-Identifier: MIT -->
<!-- MIT License. Copyright (c) 2026 Eswap contributors. See root LICENSE. -->

# Eswap Public Integrations (MIT)

Drop-in, **external** integration suite for Eswap's live Base spot-margin venue. It is
intentionally separate from the protocol core: nothing here changes deployed contracts,
governance, or the existing adapter/automation suite in `agent-integrations/`.

**Network:** Base mainnet, chain ID `8453`.
**Product:** fixed **5x** leverage (`leverageBps == 50000`), **0.00% carry / funding**
(`fundingRateBps == 0`), JIT self-bonded or permissionless solver liquidity via
`EswapRouter.erc20BorrowEscrow`.
**License:** MIT. Every generated file carries the SPDX header.

> No transaction in this directory broadcasts, queues, or executes owner actions.
> The cbBTC/USDC phase-2 registration remains a separate, explicitly approved step.

---

## 1. Canonical addresses

| Contract | Address | Notes |
| --- | --- | --- |
| `EswapMarginHook` | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` | Margin accounting, fee ledger, position solver registry |
| `EswapRouter` | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` | `swapMultiPool`, `swapWithIntent`, `closePosition`, escrow |
| Uniswap v4 `PoolManager` | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | Real Base deployment |
| CoW settlement rail | `0x7341859C0D7e039118b3f85F341583EBCDB8c960` | `fillOrder` |
| ERC-7683 / UniswapX settlement | `0x6F347acB3bD901731e192d482b7a40c50f30FCa1` | `fill` |
| Price feed | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` | Chainlink-anchored TWAP used by the hook |

### Tokens and pools

| Pair | Token 0 | Token 1 | Hook pool | Standard fill pool | Long direction |
| --- | --- | --- | --- | --- | --- |
| WETH/USDC | WETH `0x4200000000000000000000000000000000000006` (18) | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (6) | fee `3000`, spacing `60`, hook address | fee `500`, spacing `10`, hooks `0x0` | USDC in ⇒ `zeroForOne=false` |
| cbBTC/USDC | USDC (6) | cbBTC `0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf` (8) | fee `3000`, spacing `60`, hook address | fee `500`, spacing `10`, hooks `0x0` | USDC in ⇒ `zeroForOne=true` |

cbBTC/USDC is **quote-only** until the queued hook registration executes after
ETA `1795195136` = `2026-11-20 17:18:56 UTC`. The fork test warps time locally and never
executes the timelock on mainnet.

---

## 2. Exact ABI signatures

### Venue adapter (`src/adapters/IEswapMarginVenue.sol`)

```solidity
function openLeveragedPosition(
    address collateralAsset,
    address targetAsset,
    uint256 collateralAmount,
    uint256 leverageBps,
    uint256 minAmountOut,
    bytes calldata solverData
) external returns (bytes32 positionId, uint256 notionalSize);

function closeLeveragedPosition(
    bytes32 positionId,
    uint256 minAmountOut,
    bytes calldata solverData
) external returns (uint256 netPayoutUsdc);

function quoteMarginRoute(
    address collateralAsset,
    address targetAsset,
    uint256 collateralAmount,
    uint256 leverageBps
) external view returns (
    uint256 notionalOut,
    uint256 protocolFeeUsdc,
    uint256 fundingRateBps,
    uint256 estimatedGas
);
```

`leverageBps` must be exactly `50000`; anything else reverts `InvalidLeverage()`.
An unsupported token pair reverts `UnsupportedPair()`.

### Canonical router calls

```solidity
struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    PoolKey key;
    PoolKey standardPoolKey;
    bool zeroForOne;
    int256 amountSpecified;       // negative = exact margin input
    uint8 leverage;               // 5
    address solver;               // escrow-funded solver (self-bond = adapter)
    bytes hookData;               // abi.encode(true, uint8(5), trader)
    uint256 deadline;
    uint256 minAmountOut;
}

function swapMultiPool(SwapParams calldata params) external payable returns (bytes memory);
function closePosition(
    address hook,
    PoolKey calldata key,
    address trader,
    address solver,
    uint256 minAmountOut
) external;
function depositBorrowEscrow(address token, uint256 amount) external;
function erc20BorrowEscrow(address solver, address token) external view returns (uint256);
function registeredSolvers(address solver) external view returns (bool);
function quoteExactInput(
    PoolKey calldata key,
    bool zeroForOne,
    int128 amountSpecified,
    uint8 leverage
) external view returns (int128);
```

`swapMultiPool(SwapParams)` selector: **`0x33046e31`**. This is the stable terminal
selector an Enso Shortcut or generic aggregator registers.

### Settlement rails

```solidity
function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external payable;

// originData = abi.encode(PoolKey, PoolKey, bool, int256, uint8, address, bytes, uint256)

function fillOrder(
    CowOrder.Data calldata order,
    uint8 scheme,
    bytes calldata signature,
    EswapCoWSettlement.FillParams calldata params
) external returns (address owner);
```

CoW constraints: `KIND_SELL`, not partially fillable, `feeAmount == 0`, ERC-20 balance
markers on both tokens, a valid `validTo`, and `appData` carrying the leverage commitment.
The solver must be the caller.

---

## 3. Economics and custody

* Leverage is always **5x**. Margin `M` ⇒ borrow `4M` ⇒ notional `5M`.
* Carry / funding is **0 bps**. `quoteMarginRoute` returns `fundingRateBps = 0` so perp
  meta-aggregators can rank Eswap above perps with positive funding.
* The live hook charges **10 bps** on the **bought leg**:
  `protocolReserve = boughtAmount * protocolFeeFor(trader) / 10_000`.
  For a USDC-in 5x long, the USDC-equivalent fee is `notionalUsdc * feeBps / 10_000`.
  A legacy verifier/proof still hardcodes `5`; trust `protocolFeeFor` on-chain. The
  fork test asserts the honest live value (`10`) and checks the exact `protocolFees`
  delta rather than a stale constant.
* Borrow liquidity is **JIT self-bonding**: the caller deposits `4M` into
  `erc20BorrowEscrow`, or a registered / fully capitalised external solver does.
* Rehypothecation yield is paid to `positionSolver`. The adapter/solver facade claims
  100% of it and forwards it to the bonded searcher on `claimYield`.

### `solverData` encoding

| Value | Meaning | Caller funds | Router solver |
| --- | --- | --- | --- |
| `0x` | Self-bond | `M + 4M` | the adapter itself |
| `abi.encode(address solver)` | External JIT solver | `M` only | `solver`, checked for registration or full escrow coverage |

### Custody tradeoff (read this before deploying)

The venue adapter is the router **`trader`**. That is required because
`EswapRouter.closePosition` is trader-only; the adapter can therefore close the position
and forward the net USDC payout to the original caller. Consequence: **one live position
per pool per adapter deployment**. Deploy one adapter per partner/routing context and
serialize opens per pair. Do not point unrelated end-users at the same adapter instance
for the same pool concurrently.

---

## 4. Integration snippets

### 4.1 Contango / 1delta-style venue adapter

```ts
import { createPublicClient, createWalletClient, erc20Abi, http, parseUnits } from "viem";
import { base } from "viem/chains";
import venueAbi from "./abis/IEswapMarginVenue.json";

const ADAPTER = "0x..."; // your deployment of EswapMarginVenueAdapter
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const WETH = "0x4200000000000000000000000000000000000006";

const publicClient = createPublicClient({ chain: base, transport: http() });
const wallet = createWalletClient({ chain: base, transport: http() });
const margin = parseUnits("5", 6);

await wallet.writeContract({
  address: USDC,
  abi: erc20Abi,
  functionName: "approve",
  args: [ADAPTER, margin * 5n], // self-bond needs M + 4M
});

const { request: openRequest, result: [positionId, notional] } =
  await publicClient.simulateContract({
    address: ADAPTER,
    abi: venueAbi,
    functionName: "openLeveragedPosition",
    account: wallet.account!,
    args: [USDC, WETH, margin, 50_000n, 0n, "0x"], // 0x = caller self-bonds
  });
await wallet.writeContract(openRequest);

// Simulate first to read the net USDC payout, then submit the close.
const { request: closeRequest, result: payout } = await publicClient.simulateContract({
  address: ADAPTER,
  abi: venueAbi,
  functionName: "closeLeveragedPosition",
  account: wallet.account!,
  args: [positionId, 0n, "0x"],
});
await wallet.writeContract(closeRequest);
```

### 4.2 Enso Shortcut (`routingStrategy: "delegate"`)

```ts
import { EnsoClient } from "@ensofinance/sdk";
import { buildEswapEnsoBundle } from "./integrations/enso/ensoBundleExample.js";

const client = new EnsoClient({ apiKey: process.env.ENSO_API_KEY! });
const bundle = await buildEswapEnsoBundle(client, {
  pair: "WETH/USDC",
  collateralUsdc: "5",
  priceUsd18: 2_350n * 10n ** 18n, // replace with a fresh cached price
  fromAddress: "0x...",             // trader account
  solver: "0x...",                  // capitalised solver or adapter self-bond
});

console.log(bundle.quote.selector); // 0x33046e31
await wallet.sendTransaction(bundle.tx);
```

`delegate` is mandatory: approvals and the terminal router call must execute from the
trader account. With `router` strategy, the position would be credited to the Enso
executor and the adapter would not own the close path. This repository does **not**
claim an Enso listing or registration.

### 4.3 VOOI / perp meta-aggregator carry ranking

```ts
const [notionalOut, feeUsdc, fundingRateBps, estimatedGas] =
  await publicClient.readContract({
    address: ADAPTER,
    abi: venueAbi,
    functionName: "quoteMarginRoute",
    args: [USDC, WETH, parseUnits("5", 6), 50_000n],
  });

// Eswap wins any positive-funding comparison: fundingRateBps is always 0.
if (fundingRateBps === 0n && estimatedGas > 0n) {
  rank({ venue: "eswap", feeUsdc, estimatedGas });
}
```

### 4.4 UniDex / direct router calldata (no Solidity adapter)

```ts
import { ESWAP_ROUTER, simulateMarginQuote } from "./src/solvers/simulateMarginQuote.js";

const quote = simulateMarginQuote({
  pair: "WETH/USDC",
  collateralUsdc: "5",
  priceUsd18: 2_350n * 10n ** 18n,
  recipient: "0x...", // must equal the router msg.sender
  solver: "0x...",
});

// Order matters: approve margin, pre-fund the 4x borrow, then swap.
await send(quote.calldata.approveMargin);
await send(quote.calldata.depositBorrowEscrow);
await send({ to: ESWAP_ROUTER, data: quote.calldata.swapMultiPool });
```

The quoter is pure/offline: it never calls an RPC. Feed it a cached 18-decimal USD
price from your own market-data source, then use `minAmountOut` from the quote for
slippage protection.

---

## 5. Under 10 minutes: end-to-end

1. **Clone / build** (30 s): `make build` from the repository root.
2. **Run the isolated fork suite** (90 s): `make test-public-integrations`.
   Set `BASE_RPC_URL` for a reliable fork; public `https://mainnet.base.org` is the fallback.
3. **Pick an integration path** (1 min): venue adapter for Contango/VOOI, Enso bundle
   for one-click UX, or direct router calldata for UniDex-style aggregators.
4. **Approve** (1 min): `USDC.approve(ADAPTER, M * 5)` for self-bond, or `approve(ADAPTER, M)`
   with an external solver. For direct router use, approve `M` to `EswapRouter` and
   deposit `4M` via `depositBorrowEscrow`.
5. **Quote** (1 min): call `quoteMarginRoute` or `simulateMarginQuote`; assert
   `leverageBps == 50000` and `fundingRateBps == 0`.
6. **Open** (1 min): call `openLeveragedPosition` / `buildEswapEnsoBundle` / `swapMultiPool`
   with `minAmountOut` from step 5.
7. **Close** (1 min): call `closeLeveragedPosition` or `closePosition` and verify zero
   adapter dust and zero dangling router allowance.
8. **Go live** (2 min): deploy one adapter per partner context, monitor
   `protocolFees(Currency.wrap(boughtToken))`, and keep cbBTC/USDC quote-only until the
   phase-2 ETA has passed and approval is granted.

---

## 6. Files

| File | Purpose |
| --- | --- |
| `src/adapters/IEswapMarginVenue.sol` | Canonical venue interface for aggregators |
| `src/adapters/EswapMarginVenueAdapter.sol` | 5x adapter with self-bond / JIT solver modes |
| `integrations/enso/EswapEnsoAdapter.sol` | Enso selector helper + execution adapter |
| `integrations/enso/ensoBundleExample.ts` | Enso SDK bundle builder using `delegate` routing |
| `src/solvers/EswapSolverSettlementAdapter.sol` | Solver bond, intent / CoW / ERC-7683 fills, yield claim |
| `src/solvers/simulateMarginQuote.ts` | Pure quote + router calldata builder |
| `test/MarginAdapters.t.sol` | Base fork tests for all of the above |

Foundry profile: `[profile.public-integrations]` in root `foundry.toml`, artifacts in
`out-public-integrations/`. The default `make test` and deployment profiles are unchanged.
