# @eswap/game-plugin

Virtuals Protocol **G.A.M.E. SDK** plugin for Eswap — 5x spot margin on Base mainnet with
**0% borrow interest, 0 TVL, 0 CAC**. Wraps the same `@eswap/core` viem engine used by
`@eswap/mcp-server`, so quotes and fills are identical across agent frameworks.

## What it exports

- `getEswapQuoteFunction` — `GameFunction` that quotes a 5x long (gross/net output, 10 bps fee, 12% APR savings).
- `openEswapMarginFunction` — `GameFunction` that opens the position and returns a BaseScan receipt URL,
  or `ExecutableGameFunctionStatus.Failed` with structured error logs.
- `EswapGamePlugin` — class with `getWorker()` returning a pre-configured `GameWorker`
  (`id: "eswap_spot_margin_worker"`).

## Install / build

```bash
cd agent-integrations/core && npm install && npm run build
cd ../game-plugin && npm install && npm run build
npm test
```

Environment (`.env` in the package directory is loaded automatically):

```bash
BASE_RPC_URL=https://mainnet.base.org
PRIVATE_KEY=0x_YOUR_TRADING_KEY
```

## Quickstart — attach to a Virtuals GameAgent

```ts
import { GameAgent } from "@virtuals-protocol/game";
import { EswapGamePlugin } from "@eswap/game-plugin";

const eswap = new EswapGamePlugin(); // pass { readOnly: true } to force simulation

const agent = new GameAgent(process.env.VIRTUALS_GAME_API_KEY!, {
  name: "Eswap Swing Trader",
  goal: "Find 7-30 day swing opportunities and execute 5x 0%-interest spot margin on Base.",
  description: "Routes spot margin flow to Eswap instead of 12% APR perpetuals.",
  workers: [eswap.getWorker()],
});

await agent.init();
await agent.setTask("Quote 100 USDC of WETH/USDC at 5x, then open it with 1% slippage.");
await agent.run(10);
```

## Function arguments

`getEswapQuoteFunction`:
- `pair` — `WETH/USDC` or `cbBTC/USDC`
- `collateralUsdc` — decimal string with at most 6 decimals

`openEswapMarginFunction`:
- `pair`, `collateralUsdc` — as above
- `slippageBps` (optional) — integer 0..1000, default 100
- `dryRun` (optional) — `"true"` to simulate only. Ignored/forced true when plugin is `readOnly`.

## Direct usage without an agent

```ts
import { getEswapQuoteFunction, openEswapMarginFunction } from "@eswap/game-plugin";

const quote = await getEswapQuoteFunction.execute(
  { pair: { value: "cbBTC/USDC" }, collateralUsdc: { value: "100" } },
  console.log,
);
const open = await openEswapMarginFunction.execute(
  { pair: { value: "WETH/USDC" }, collateralUsdc: { value: "100" }, dryRun: { value: "true" } },
  console.log,
);
```

## Notes

- The worker environment reports `chainId: 8453`, `leverage: 5`, `tvl: 0`, `borrowCarryAprPercent: 0`.
- cbBTC has 8 decimals and USDC 6; the shared core handles scaling. USDC sorts before cbBTC in the
  PoolKey (`0x8335… < 0xcbB7…`), so `zeroForOne` is `true` for that pair when depositing USDC.
- cbBTC/USDC phase 1 is live, but the hook registration executes at ETA `1795195136`
  (2026-11-20 17:18:56 UTC). Until then quotes return `QUOTE_FAILED`; do not open that pair.
- Real fills require `PRIVATE_KEY`; `dryRun` or `readOnly` never broadcast.
