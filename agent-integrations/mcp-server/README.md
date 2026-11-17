# @eswap/mcp-server

Universal Model Context Protocol server for **Eswap** — 5x spot margin on Base mainnet with
**0% interest, 0 TVL, 0 CAC**. Works with Claude Desktop, Cursor, Shinkai, OKX Agent Trade Kit and
any MCP-compatible client. Both `stdio` and Streamable HTTP transports are supported.

## Tools

| Tool | Purpose |
| --- | --- |
| `eswap_get_quote` | Quote 5x spot margin output, 10 bps fee, and 0% vs 12% APR carry savings (7d/30d) for `WETH/USDC` or `cbBTC/USDC`. |
| `eswap_open_spot_margin` | Approve USDC, self-bond the 4x borrow in `erc20BorrowEscrow`, and call `router.swapMultiPool`. Returns a BaseScan URL. `dryRun:true` simulates only. |
| `eswap_get_pool_info` | Verified Base addresses, both PoolKey structs, live fee/treasury telemetry and a 1 USDC probe quote per pair. |

Resource: `eswap://protocol/specs` — structured JSON explaining the 0% carry clearinghouse, JIT
solver capital, and why ERC-4626 vault models are explicitly rejected.

## Install

```bash
cd agent-integrations/core && npm install && npm run build
cd ../mcp-server && npm install && npm run build
npm test
```

Set `BASE_RPC_URL` and (for real fills) `PRIVATE_KEY` in the environment. `.env` in the package
directory is loaded automatically. Use a dedicated trading key — this server signs transactions.

## Claude Desktop

Add to `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "eswap": {
      "command": "npx",
      "args": ["-y", "@eswap/mcp-server"],
      "env": {
        "BASE_RPC_URL": "https://mainnet.base.org",
        "PRIVATE_KEY": "0x_YOUR_TRADING_KEY"
      }
    }
  }
}
```

For simulation-only agents add `"--read-only"` to `args` (or set `ESWAP_READ_ONLY=1`).

Local checkout alternative:

```json
{
  "mcpServers": {
    "eswap": {
      "command": "node",
      "args": ["C:/Users/you/OneDrive/Documents/Default Project/agent-integrations/mcp-server/dist/index.js"],
      "env": { "BASE_RPC_URL": "https://mainnet.base.org" }
    }
  }
}
```

## Cursor

Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "eswap": {
      "command": "npx",
      "args": ["-y", "@eswap/mcp-server"],
      "env": {
        "BASE_RPC_URL": "https://mainnet.base.org",
        "PRIVATE_KEY": "0x_YOUR_TRADING_KEY"
      }
    }
  }
}
```

## CLI

```bash
# stdio (default; used by desktop clients)
npx @eswap/mcp-server
node dist/index.js --read-only

# Streamable HTTP at POST /mcp, health at GET /healthz
node dist/index.js --http --port 3000
```

Environment switches: `MCP_TRANSPORT=http`, `MCP_HTTP_PORT=3000`, `ESWAP_READ_ONLY=1`.
All diagnostics go to stderr so the stdio channel stays JSON-RPC clean.

## Safety notes

- WETH/USDC quotes resolve live on Base. cbBTC/USDC pools are not initialized on-chain yet, so
  that pair returns `QUOTE_FAILED` until governance registers it (the code is ready).
- `dryRun: true` is supported on `eswap_open_spot_margin` and never broadcasts.
- `--read-only` forces `dryRun: true` even if the agent asks for a live fill.
- Quote output is a spot approximation from the execution pool's `slot0`, not a guaranteed fill.
- USDC has 6 decimals, WETH 18, cbBTC 8. The core enforces exact scaling.
- Uniswap v4 sorts pool currencies by address: WETH is `currency0` for WETH/USDC, but USDC is
  `currency0` for cbBTC/USDC (`0x8335… < 0xcbB7…`). The core derives `zeroForOne` accordingly.

## Live contracts (Base 8453)

- Hook `0x7b3F232BB5a0346fADb8B92B31B3e7bC60bD90c8`
- Router `0x5b226aE5158de86f1E616875dBab886870B9aAd9`
- PoolManager `0x498581fF718922c3f8e6A244956aF099B2652b2b`
