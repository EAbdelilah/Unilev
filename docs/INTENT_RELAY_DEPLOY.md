# Hosting the Eswap intent relay

The relay is not a separate service. It ships as Next.js App Router handlers
inside `dashboard/`, so deploying the dashboard gives solvers a free 24/7 HTTPS
feed at `https://<domain>/api/intents?status=open`.

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | `GET` | Liveness + chain/RPC check |
| `/api/intents` | `GET` | Feed. `?status=open` returns open, unexpired, unfilled intents |
| `/api/intents` | `POST` | Submit `{order, scheme, signature}`; verified on chain before listing |
| `/api/intents/[id]` | `GET` | One intent by on-chain order UID |
| `/api/intents/[id]/filled` | `POST` | Mark filled; rejected with 409 until `filledOrders(id)` is true on chain |

The relay never holds funds, never signs, and never submits a transaction.

## 1. Environment

Set these in the host's dashboard (never commit them):

**Server-only**

| Variable | Required | Notes |
|---|---|---|
| `BASE_RPC_URL` | yes | Keyed Base mainnet RPC. The relay reads `verify`, `filledOrders`, `balanceOf` and `allowance` |
| `V4_COW_SETTLEMENT_ADDRESS` | no | Defaults to the live `0x7341859C0D7e039118b3f85F341583EBCDB8c960` |
| `RELAY_MAX_INTENTS` | no | In-memory book cap (default 2000) |

**Public (baked into the client bundle)**

All `NEXT_PUBLIC_V4_*` addresses, `NEXT_PUBLIC_CHAIN_ID=8453`,
`NEXT_PUBLIC_MIN_COLLATERAL_USD`, and the `NEXT_PUBLIC_*` RPC URL. These are
written by `node javascript/update-dashboard.js`, which parses the broadcast
records and `.env`; do not hand-edit them.

`dashboard/.env.local` already contains the live values and is the reference.

## 2. Storage caveat — read before choosing a host

The default intent book is an in-memory `Map` on `globalThis`. It is a
*convenience feed*, not the source of truth: the authoritative record is the
on-chain `EswapCoWSettlement`, and a solver can rebuild the book from
`OrderFilled` events.

That means:

* **Recommended for now:** a single long-running Node process
  (`next start`) on Fly.io / Railway / Render / a VPS. One process = one
  consistent book, and the dashboard routes work unchanged.
* **Vercel / Netlify:** the UI deploys fine, but serverless functions may run
  several instances, so a `POST` and a later `GET` can land on different
  instances and the feed can look empty. Use a single region / one instance, or
  add a durable store before pointing solvers at it.
* Redis is **not implemented** in this tree (`INTENT_STORE=redis` is a
  documented future option only). Do not set it expecting durability.

## 3. Vercel

1. Import the repository.
2. Set **Root Directory** to `dashboard` (the monorepo root has its own
   `package-lock.json`).
3. Framework preset: Next.js. Build command `next build`, output `.next`.
4. Add the environment variables from §1 (Production + Preview).
5. Deploy, then verify:

```bash
curl -fsS https://<domain>/api/health
curl -fsS "https://<domain>/api/intents?status=open"
```

`dashboard/vercel.json` pins the framework so the root-directory setting is the
only manual step.

## 4. Netlify

`dashboard/netlify.toml` sets the base directory, build command and the Next.js
runtime plugin. Import the repository, add the §1 environment variables, and
deploy. Verify with the same two `curl` calls.

## 5. Single-instance host (recommended)

```bash
cd dashboard
node node_modules/next/dist/bin/next build
node node_modules/next/dist/bin/next start -p 3000
```

Put it behind the platform's TLS proxy. On Fly/Railway/Render set the same §1
environment variables; the build must run where `.env.local` (or the platform
env) is available.

## 6. Publish the feed to solvers

Once the host answers, set the feed URL wherever the solver bot runs:

```bash
INTENT_FEED_URL=https://<domain>/api/intents?status=open
```

Then run the bot against it:

```bash
node node_modules/tsx/dist/cli.mjs scripts/solvers/cowSolverBot.ts --dry-run
```

The bot verifies each signature on chain, rejects unfunded/unapproved orders,
prints the escrow bond it must post, and only sends in live mode.

## 7. What is still missing

* No public host is deployed from this repository yet; the steps above are the
  deployment path, not a completed deployment.
* No external solver has bonded and filled. The feed being public is necessary
  but not sufficient: the solver must fund the borrow leg in
  `EswapCoWSettlement` escrow first (see `docs/SOLVER_INTEGRATION_GUIDE.md`).
