# Eswap Private Engine (private root)

This directory is the policy boundary for non-public protocol tooling. Nothing in this
workspace is exported to `eswap-public-integrations/`, which is a separate MIT repository.

Never copy the following into the public export:

- `scripts/v4/live/withdrawFees.cjs` and other owner/live-operation scripts
- deployment keys, `.env`, `.env.local.v4`, and private RPC configuration
- live proof, broadcast, build, and test logs
- internal deployment or partner configuration

`eswap-public-integrations/scripts/verifyPublicExport.ts` is the automated pre-push guardrail:
it fails on embedded secrets, references to internal-only tooling, or non-MIT licenses.
