# Gelato Automation Guide for Eswap Trigger Orders (Base mainnet, chainId 8453)

**Date:** 2026-11-18
**Scope:** build a Gelato Web3 Function that reads Eswap's oracle, executes trader-signed stop-loss/limit closes on `EswapRouterExt`, and falls back to close or liquidation paths.
**Status:** developer guide against live Base contracts. **No Gelato task is deployed by this repository.**
**Chain:** Base mainnet (chainId `8453`).

---

## 1. Division of responsibility

| Actor | Allowed | Not allowed |
|---|---|---|
| Trader | Sign `TriggerOrder` EIP-712; `armTriggerOrder`; `closePosition` | — |
| Gelato W3F keeper | Read oracle; `executeTriggerOrder`; `liquidate` | `closePosition` (trader-only); arming for a trader |
| Contracts | Enforce signature, cross, nonce, payout floor | Guarantee a keeper runs |

The keeper holds no trader funds. It cannot change `minAmountOut` or direction: both are pinned by the trader's EIP-712 signature.

---

## 2. Project setup

```bash
npx @gelatonetwork/web3-functions-sdk@latest create eswap-trigger-keeper  # flags vary by SDK version
cd eswap-trigger-keeper
npm install @gelatonetwork/web3-functions-sdk viem
# web3-function.json -> metadata, userArgs, secrets
# src/index.ts -> onRun ; src/logic.ts -> pure hit-test ; test/logic.test.ts
```

`@eswap/core/automation` provides the reference primitives for this W3F. They are pure and
injection-friendly; importing them does **not** deploy a task or grant keeper permissions:

```ts
import {
  createGelatoWeb3Function,
  createPriceFeedMarketPriceReader,
  buildTriggerOrderTypedData,
} from "@eswap/core/automation";

const keeper = createGelatoWeb3Function({
  getMarketPrice18: createPriceFeedMarketPriceReader(client),
});
// keeper.onRun(userArgs) -> { canExec, callData, reason }
```

`buildTriggerOrderTypedData` produces the trader's EIP-712 payload; the keeper never signs it.

Pinned live addresses (no retired/Unichain addresses):

| Contract | Address |
|---|---|
| `EswapRouter` (EIP-712 verifying contract) | `0x5b226aE5158de86f1E616875dBab886870B9aAd9` |
| `EswapRouterExt` (arm/execute) | `0x907CdA8c588c9C859A6fB4F105593a64599741CB` |
| `EswapMarginHook` | `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8` |
| `PriceFeed` | `0x91d75C7f750510C04516fC4dcEB5737E5B170c02` |
| WETH / USDC / cbBTC | `0x4200…0006` / `0x8335…2913` / `0xcbB7…33Bf` |

---

## 3. `userArgs` schema

```json
{
  "name": "eswap-trigger-keeper",
  "description": "Execute Eswap trader-signed trigger closes and permissionless liquidations on Base.",
  "version": "1.0.0",
  "network": { "chainId": 8453 },
  "userArgs": {
    "mode": "trigger",
    "routerExt": "0x907CdA8c588c9C859A6fB4F105593a64599741CB",
    "hook": "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8",
    "priceFeed": "0x91d75C7f750510C04516fC4dcEB5737E5B170c02",
    "trader": "0x0000000000000000000000000000000000000000",
    "currency0": "0x4200000000000000000000000000000000000006",
    "currency1": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "fee": "3000",
    "tickSpacing": "60",
    "hooks": "0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8"
  },
  "secrets": { "baseRpcUrl": "BASE_RPC_URL" }
}
```

`mode` is `trigger` or `liquidate`; other values are rejected. Currencies must be sorted ascending and match `PoolKey.toId()`. Hook pool is `3000/60` with the hook; standard fill pool is `500/10` with no hooks. **Signed fields (`triggerPrice18`, `aboveOrBelow`, `minAmountOut`, `closeDeadline`, `nonce`) are read from the armed order on chain, never from `userArgs`.**

---

## 4. Reading `PriceFeed.getAmountInUsd`

The view returns the 18-decimal USD value of **raw token units**. Pass `10 ** decimals` to price one whole token.

```ts
const PRICE_FEED_ABI = [{
    type: "function", name: "getAmountInUsd", stateMutability: "view",
    inputs: [{ name: "token", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "uint256" }],
}] as const
const DECIMALS: Record<string, number> = { [WETH]: 18, [USDC]: 6, [CBBTC]: 8 }

const price0 = await client.readContract({ address: PRICE_FEED, abi: PRICE_FEED_ABI,
    functionName: "getAmountInUsd", args: [key.currency0, 10n ** BigInt(DECIMALS[key.currency0])] })
const price1 = await client.readContract({ address: PRICE_FEED, abi: PRICE_FEED_ABI,
    functionName: "getAmountInUsd", args: [key.currency1, 10n ** BigInt(DECIMALS[key.currency1])] })
if (price0 === 0n || price1 === 0n) return { canExec: false, message: "oracle unavailable" }

// Identical to RouterExt._computeMarketPrice18:
const marketPrice18 = (price0 * 10n ** 18n) / price1
```

A zero or stale leg must fail closed; otherwise an unpriced pair can look like a crossed stop.

---

## 5. Trigger direction table

`marketPrice18 = price(token0) / price(token1)`; currency order is ascending address.

| Pair | token0 | token1 | Typical price | Long stop-loss | `aboveOrBelow` |
|---|---|---|---|---|---|
| WETH/USDC | WETH (`0x4200…06`) | USDC (`0x8335…13`) | ~`3000e18` | WETH falls → market **falls** | `false` (market < trigger) |
| cbBTC/USDC | USDC (`0x8335…13`) | cbBTC (`0xcbB7…Bf`) | ~`1/60000 e18` | cbBTC falls → ratio **rises** | `true` (market ≥ trigger) |

The cbBTC inversion is the common integration bug: USDC is token0. cbBTC/USDC phase 1 is live, but hook registration executes at ETA `1795195136` = `2026-11-20 17:18:56 UTC`; until then quotes return `QUOTE_FAILED` and the W3F must reject cbBTC tasks.

---

## 6. `onRun` canExec logic

```ts
import { Web3Function, Web3FunctionContext } from "@gelatonetwork/web3-functions-sdk"

Web3Function.onRun(async (context: Web3FunctionContext) => {
    const { userArgs, secrets } = context
    const rpcUrl = secrets.get("baseRpcUrl")
    if (!rpcUrl) return { canExec: false, message: "missing RPC secret" }
    if (userArgs.mode !== "trigger") return { canExec: false, message: "unsupported mode" }

    const key = makePoolKey(userArgs)                 // currency0, currency1, fee, tickSpacing, hooks
    const poolId = poolIdOf(key)                      // keccak256(abi.encode(PoolKey components))
    const trader = userArgs.trader as Address

    // Signed fields come from the armed slot, not from userArgs.
    const order = await client.readContract({ address: ROUTER_EXT, abi: ROUTER_EXT_ABI,
        functionName: "armedTriggerOrders", args: [trader, poolId] })
    if (order.closeDeadline === 0n) return { canExec: false, message: "no armed order" }
    if (now() > order.closeDeadline) return { canExec: false, message: "expired" }

    const executionId = keccak256(encodeAbiParameters(
        [{ name: "trader", type: "address" }, { name: "poolId", type: "bytes32" },
         { name: "nonce", type: "uint256" }], [trader, poolId, order.nonce]))
    if (await client.readContract({ address: ROUTER_EXT, abi: ROUTER_EXT_ABI,
        functionName: "executedTriggerOrders", args: [executionId] }))
        return { canExec: false, message: "nonce consumed" }

    const marketPrice18 = await readMarketPrice18(client, key)   // §4; 0 => null
    if (marketPrice18 === null) return { canExec: false, message: "oracle unavailable" }

    // Pure hit-test: true => market >= trigger ; false => market < trigger.
    if (!shouldExecute(marketPrice18, order)) return { canExec: false, message: "not crossed" }

    return { canExec: true, callData: [{
        to: ROUTER_EXT,
        data: encodeFunctionData({ abi: ROUTER_EXT_ABI, functionName: "executeTriggerOrder",
            args: [userArgs.hook, key, trader] }),   // selector 0x69e7684f
    }] }
})
```

`shouldExecute` belongs in `src/logic.ts` and is unit tested at the boundary: equality fires only for `aboveOrBelow=true`. The contract deliberately lets a trigger close execute even for a liquidatable position, because the trader's signed `minAmountOut` still bounds the fill.

---

## 7. Arming the order (trader side, one-time)

Domain: name `"EswapRouter"`, version `"1"`, chainId `8453`, verifyingContract = **core router** (not the ext).

```ts
const domain = { name: "EswapRouter", version: "1", chainId: 8453,
    verifyingContract: "0x5b226aE5158de86f1E616875dBab886870B9aAd9" } as const
const types = { TriggerOrder: [
    { name: "poolId", type: "bytes32" },
    { name: "triggerPrice18", type: "uint256" },
    { name: "aboveOrBelow", type: "bool" },
    { name: "minAmountOut", type: "uint256" },
    { name: "closeDeadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "executorTipBps", type: "uint8" },
] } as const
const signature = await walletClient.signTypedData({
    account: trader, domain, types, primaryType: "TriggerOrder", message: order,
})
// The TRADER submits this: armTriggerOrder checks msg.sender == signer
// (EOA ECDSA or EIP-1271 smart-account wallet).
await walletClient.writeContract({ address: ROUTER_EXT, abi: ROUTER_EXT_ABI,
    functionName: "armTriggerOrder", args: [key, order, signature] })
```

`executorTipBps` is capped at `1000` (10%). One order per (trader, pool); re-arming overwrites; `cancelTriggerOrder(trader, key)` is trader-only.

---

## 8. Execute calldata and fallbacks

```solidity
// EswapRouterExt.sol — permissionless after arm + cross
function executeTriggerOrder(address hook, PoolKey calldata key, address trader) external;
// EswapRouter.sol
function closePosition(address hook, PoolKey calldata key, address trader, address solver, uint256 minAmountOut) external; // require(msg.sender == trader)
function liquidate(address hook, PoolKey calldata key, address trader, uint256 minAmountOut) external;                      // permissionless
```

| Path | Call | Caller | When |
|---|---|---|---|
| Trigger close | `executeTriggerOrder(hook, key, trader)` — `0x69e7684f` | Permissionless | Price crossed, order armed |
| Manual close | `closePosition(hook, key, trader, solver, minAmountOut)` | **Trader only** | Early exit before trigger |
| Liquidation | `liquidate(hook, key, trader, minAmountOut)` | Permissionless | Position underwater |

```ts
// Fallback A: the keeper can PREPARE this calldata for a trader-controlled
// account/Safe to submit, but cannot send it from its own EOA.
const closeCalldata = encodeFunctionData({ abi: ROUTER_ABI, functionName: "closePosition",
    args: [HOOK, key, trader, solver, minAmountOut] })
// Fallback B: permissionless. Derive minAmountOut from a fresh oracle quote.
const liquidateCalldata = encodeFunctionData({ abi: ROUTER_ABI, functionName: "liquidate",
    args: [HOOK, key, trader, liquidationMinOut] })
```

Gate liquidation on real position health (hook position state / liquidatability), not a price guess.

---

## 9. Secrets and environment

```bash
export BASE_RPC_URL="https://mainnet.base.org"   # prefer a private, rate-limited endpoint
# Keeper key belongs to the Gelato executor; trader key stays with the trader.
```

- `baseRpcUrl` is declared in `web3-function.json` `secrets` and read with `secrets.get`.
- Keeper signing key: held by the executor, **not** in `userArgs`.
- Trader signing key: never shared with the keeper.
- Reject any task whose `userArgs` contains a private-key-like field.

---

## 10. Testing

```bash
npm test                                   # pure shouldExecute(): boundary, zero price, expiry
anvil --fork-url $BASE_RPC_URL --fork-block-number <live-block>
npx hardhat w3f-run --network base --args <args-file> --secrets <secrets-file>  # flags vary by SDK version
```

Minimum matrix: crossed / not crossed; equality with `aboveOrBelow=true` fires and with `false` does not; `price0` or `price1` zero → no exec; no armed order, expired, or consumed nonce → no exec; cbBTC before ETA `1795195136` → hard reject; successful execution consumes the nonce so a replay reverts `TriggerOrderAlreadyExecuted`.

---

## 11. What is NOT claimed

- **No Gelato task is deployed by this repository.** No live Web3 Function, funded keeper, or executed automation run is attached to this guide.
- **No Gelato endorsement or audit** is implied.
- **No execution guarantee.** Permissionless does not mean automatic; RPC failure, gas spikes, or no keeper can leave an order unexecuted (liquidation remains available).
- **No keeper control of funds.** It cannot sign for the trader, alter the payout floor, or call `closePosition`.
- **No cbBTC automation before phase 2** (hook registration ETA `1795195136`); `QUOTE_FAILED` is a hard stop.
- **No claim that CLI flags are stable** across `web3-functions-sdk` versions; verify against the installed version.
