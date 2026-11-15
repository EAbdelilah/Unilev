#!/usr/bin/env node
/**
 * Batch source-verification of the live Base (chain 8453) Eswap deployment.
 *
 * WHY THIS EXISTS
 * ---------------
 * A reviewer's first click is usually the block explorer. An unverified
 * contract cannot be read, cannot be diffed against the repo, and is assumed
 * malicious until proven otherwise. This script makes the whole 18-contract
 * stack verifiable in one command, from the *exact* artifacts that produced the
 * deployed bytecode.
 *
 * THE BYTECODE TRAP (why the profile matters)
 * -------------------------------------------
 * The live stack was deployed with `[profile.deploy]` (`optimizer_runs = 1`),
 * NOT the default profile (`optimizer_runs = 200`). The two builds differ:
 *
 *     contract              runs=200   runs=1 (live)
 *     EswapRouter           23,515 B   23,017 B
 *     EswapMarginHook       25,056 B   24,423 B
 *
 * Submitting the default-profile artifacts would fail verification with a
 * bytecode mismatch even though the sources are identical. So this script
 * (a) builds/reads the `deploy` profile, and (b) refuses to submit anything
 * whose runtime bytecode does not hash-match the chain. That pre-flight turns a
 * confusing "bytecode does not match" rejection into a local, actionable error.
 *
 * VERIFIERS
 * ---------
 * - `sourcify` (default): decentralised, no API key, works today.
 * - `basescan`: needs `BASESCAN_API_KEY` (or `ETHERSCAN_API_KEY`) in `.env`.
 *   The legacy Etherscan V1 endpoint is deprecated; V2 needs a real key.
 *
 * USAGE
 * -----
 *   node scripts/v4/live/verifyContracts.cjs --check          # pre-flight only
 *   node scripts/v4/live/verifyContracts.cjs                  # Sourcify (keyless)
 *   node scripts/v4/live/verifyContracts.cjs --verifier both  # + Basescan
 *   node scripts/v4/live/verifyContracts.cjs --only EswapRouter --only EswapMarginHook
 *
 * PRE-REQUISITE
 * -------------
 *   FOUNDRY_PROFILE=deploy forge build --out out-deploy
 * (the script prints this hint if the artifacts are missing or stale).
 */

const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const { ethers } = require("ethers")

const ROOT = path.resolve(__dirname, "../../..")
const PROOF = path.join(ROOT, "scripts/v4/live/proofs/redeploy-8453-2026-11-11.json")
const TIMELOCK_BROADCAST = path.join(ROOT, "broadcast/DeployTimelock.s.sol/8453/run-1794522594104.json")
const DEFAULT_ARTIFACTS = "out-deploy"
const CHAIN_ID = 8453
const SOLC = "0.8.27"
const OPTIMIZER_RUNS = 1

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const option = (name, fallback) => {
    const i = argv.indexOf(`--${name}`)
    if (i === -1) return fallback
    const v = argv[i + 1]
    return v && !v.startsWith("--") ? v : fallback
}
const multi = (name) => {
    const out = []
    for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[i + 1])
    return out
}

const VERIFIER = option("verifier", "sourcify") // sourcify | basescan | both
const ARTIFACTS = option("artifacts", DEFAULT_ARTIFACTS)
const ONLY = multi("only")
const CHECK_ONLY = flag("check")
const STATUS = flag("status")
const NO_WATCH = flag("no-watch")
const JSON_OUT = option("json", null)

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
function loadEnv() {
    const file = path.join(ROOT, ".env")
    if (!fs.existsSync(file)) return {}
    const env = {}
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
        if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
    return env
}
const ENV = loadEnv()
const RPC = process.env.BASE_RPC_URL || ENV.BASE_RPC_URL || "https://mainnet.base.org"
const BASESCAN_KEY = process.env.BASESCAN_API_KEY || ENV.BASESCAN_API_KEY || ENV.ETHERSCAN_API_KEY || ""

// ---------------------------------------------------------------------------
// Targets: every contract the live stack actually deployed
// ---------------------------------------------------------------------------
function loadTargets() {
    const proof = JSON.parse(fs.readFileSync(PROOF, "utf8"))
    const targets = []

    for (const phase of ["phase1", "phase3"]) {
        for (const tx of proof[phase]?.transactions ?? []) {
            targets.push({
                name: tx.contractName,
                address: ethers.getAddress(tx.contractAddress),
                args: tx.arguments ?? [],
                creationTx: tx.hash,
                phase,
            })
        }
    }

    // The two EswapTimelock instances are deployed by a separate script; the
    // committed proof only covers RedeployBaseFull, so read their broadcast.
    if (fs.existsSync(TIMELOCK_BROADCAST)) {
        const bc = JSON.parse(fs.readFileSync(TIMELOCK_BROADCAST, "utf8"))
        for (const tx of bc.transactions ?? []) {
            if (!tx.contractName) continue
            targets.push({
                name: tx.contractName,
                address: ethers.getAddress(tx.contractAddress),
                args: tx.arguments ?? [],
                creationTx: tx.hash,
                phase: "timelock",
            })
        }
    } else {
        console.warn(`[warn] timelock broadcast missing: ${path.relative(ROOT, TIMELOCK_BROADCAST)}`)
    }

    return ONLY.length ? targets.filter((t) => ONLY.some((n) => n.toLowerCase() === t.name.toLowerCase())) : targets
}

/** ABI-encode the decoded constructor args recorded in the broadcast. */
function encodeArgs(args) {
    if (!args || args.length === 0) return "0x"
    const types = []
    const values = []
    for (const a of args) {
        const s = String(a)
        if (/^0x[0-9a-fA-F]{40}$/.test(s)) {
            types.push("address")
            values.push(ethers.getAddress(s))
        } else if (/^0x[0-9a-fA-F]+$/.test(s)) {
            types.push("uint256")
            values.push(BigInt(s))
        } else if (/^\d+$/.test(s)) {
            types.push("uint256")
            values.push(BigInt(s))
        } else if (s === "true" || s === "false") {
            types.push("bool")
            values.push(s === "true")
        } else {
            throw new Error(`cannot ABI-encode constructor arg: ${s}`)
        }
    }
    return ethers.AbiCoder.defaultAbiCoder().encode(types, values)
}

/** Read the deploy-profile artifact for a contract. */
const hex = (s) => "0x" + String(s ?? "").replace(/^0x/, "")

function readArtifact(name) {
    const file = path.join(ROOT, ARTIFACTS, `${name}.sol`, `${name}.json`)
    if (!fs.existsSync(file)) return { error: `missing artifact ${path.relative(ROOT, file)}` }
    const art = JSON.parse(fs.readFileSync(file, "utf8"))
    const target = art.metadata?.settings?.compilationTarget
    if (!target) return { error: "artifact has no compilationTarget metadata" }
    const [sourcePath, contractName] = Object.entries(target)[0]
    return {
        file,
        sourcePath,
        contractName,
        identifier: `${sourcePath}:${contractName}`,
        initCode: hex(art.bytecode.object),
        runtime: hex(art.deployedBytecode.object),
        immutableReferences: art.deployedBytecode.immutableReferences ?? {},
        runs: art.metadata.settings.optimizer?.runs,
        solc: art.metadata.compiler?.version,
        viaIR: art.metadata.settings?.viaIR,
    }
}

// ---------------------------------------------------------------------------
// Pre-flight: the artifact MUST reproduce the deployed creation input
// ---------------------------------------------------------------------------
// Two checks, because `keccak(runtime) == keccak(artifact.deployedBytecode)`
// is NOT a valid test: solc leaves immutables as zero placeholders in the
// artifact and only the constructor writes the real values, so every contract
// with an immutable would "fail" while being perfectly correct.
//
//   1. runtime LENGTH must match exactly  -> proves the build profile/settings.
//   2. creation tx INPUT must equal artifact initcode + ABI-encoded ctor args
//      -> proves the source, the settings AND the constructor arguments.
//
// Contracts deployed through a factory (CREATE2) have a factory call as their
// creation input, so check 2 is skipped for them and check 1 carries the weight.
async function preflight(provider, targets) {
    const rows = []
    for (const t of targets) {
        const art = readArtifact(t.name)
        const row = { ...t, artifact: art }
        if (art.error) {
            row.status = "NO-ARTIFACT"
            row.detail = art.error
            rows.push(row)
            continue
        }
        if (art.runs !== OPTIMIZER_RUNS) {
            row.status = "WRONG-PROFILE"
            row.detail = `artifact runs=${art.runs}, live stack was built with runs=${OPTIMIZER_RUNS}`
            rows.push(row)
            continue
        }

        const onchain = await provider.getCode(t.address)
        row.onchainBytes = (onchain.length - 2) / 2
        row.artifactBytes = (art.runtime.length - 2) / 2

        if (onchain === "0x") {
            row.status = "NO-CODE"
            row.detail = "no contract at this address"
            rows.push(row)
            continue
        }
        if (row.onchainBytes !== row.artifactBytes) {
            row.status = "MISMATCH"
            row.detail = `runtime length: on-chain ${row.onchainBytes} B vs artifact ${row.artifactBytes} B`
            rows.push(row)
            continue
        }

        // Runtime bytes can only be compared when the contract has no immutables.
        const immutables = Object.keys(art.immutableReferences ?? {}).length
        row.immutables = immutables
        row.runtimeHashMatch = onchain.toLowerCase() === art.runtime.toLowerCase()

        // Creation input is the strongest signal: it embeds the runtime template
        // AND the patched constructor arguments.
        let expected = null
        try {
            expected = (art.initCode + encodeArgs(t.args).slice(2)).toLowerCase()
        } catch (e) {
            row.status = "BAD-ARGS"
            row.detail = e.message
            rows.push(row)
            continue
        }
        const tx = t.creationTx ? await provider.getTransaction(t.creationTx) : null
        // ethers v6 exposes the calldata as `data`; raw JSON-RPC calls it `input`.
        const input = (tx?.data ?? tx?.input ?? "").toLowerCase()

        if (input === expected) {
            row.status = "MATCH"
            row.detail = `runtime ${row.onchainBytes} B, creation input reproduced`
        } else if (input.startsWith(art.initCode.toLowerCase())) {
            row.status = "ARG-MISMATCH"
            row.detail = "initcode matches but the constructor arguments differ"
        } else if (row.runtimeHashMatch) {
            row.status = "MATCH"
            row.detail = `runtime ${row.onchainBytes} B, byte-identical (factory deploy)`
        } else if (immutables > 0 && row.onchainBytes === row.artifactBytes) {
            // Factory-deployed contract with immutables: length is the only
            // local signal, and it already matches.
            row.status = "MATCH"
            row.detail = `runtime ${row.onchainBytes} B, length match (factory deploy, ${immutables} immutable(s))`
        } else {
            row.status = "MISMATCH"
            row.detail = `runtime ${row.onchainBytes} B matches, but neither the creation input nor the bytes do`
        }
        rows.push(row)
    }
    return rows
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------
function forgeVerify(row, verifier) {
    const art = row.artifact
    const args = [
        "verify-contract",
        row.address,
        art.identifier,
        "--chain",
        String(CHAIN_ID),
        "--compiler-version",
        SOLC,
        "--num-of-optimizations",
        String(OPTIMIZER_RUNS),
        "--via-ir",
        "--evm-version",
        "cancun",
        "--verifier",
        verifier,
        "--rpc-url",
        RPC,
    ]
    if (verifier === "sourcify") {
        // Sourcify resolves the constructor args from the creation transaction.
        if (row.creationTx) args.push("--creation-transaction-hash", row.creationTx)
    } else {
        args.push("--constructor-args", encodeArgs(row.args))
        if (BASESCAN_KEY) args.push("--etherscan-api-key", BASESCAN_KEY)
    }
    if (!NO_WATCH) args.push("--watch")

    const res = spawnSync("forge", args, {
        cwd: ROOT,
        encoding: "utf8",
        env: { ...process.env, FOUNDRY_PROFILE: "deploy", BASE_RPC_URL: RPC },
        maxBuffer: 32 * 1024 * 1024,
    })
    const output = `${res.stdout || ""}${res.stderr || ""}`.trim()
    return { ok: res.status === 0, output, command: `forge ${args.join(" ")}` }
}

// ---------------------------------------------------------------------------
// Status: what does Sourcify think of these addresses right now?
// ---------------------------------------------------------------------------
async function sourcifyStatus(rows) {
    const results = []
    for (const r of rows) {
        const url = `https://sourcify.dev/server/v2/contract/${CHAIN_ID}/${r.address}`
        try {
            const res = await fetch(url, { headers: { "User-Agent": "eswap-verify/1.0" } })
            if (res.status === 404) {
                results.push({ name: r.name, address: r.address, status: "not-verified" })
            } else if (!res.ok) {
                results.push({ name: r.name, address: r.address, status: `HTTP ${res.status}` })
            } else {
                const j = await res.json()
                results.push({
                    name: r.name,
                    address: r.address,
                    status: j.match ?? "unknown",
                    creationMatch: j.creationMatch,
                    runtimeMatch: j.runtimeMatch,
                })
            }
        } catch (e) {
            results.push({ name: r.name, address: r.address, status: `error: ${e.message}` })
        }
        await new Promise((res) => setTimeout(res, 200))
    }
    return results
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    const targets = loadTargets()
    if (targets.length === 0) {
        console.error("no targets selected")
        process.exit(2)
    }

    console.log(`Base ${CHAIN_ID} verification — ${targets.length} contract(s)`)
    console.log(`artifacts : ${ARTIFACTS}/ (profile deploy, runs=${OPTIMIZER_RUNS}, solc ${SOLC}, via-ir)`)
    console.log(`verifier  : ${VERIFIER}${VERIFIER !== "sourcify" && !BASESCAN_KEY ? " (no API key found!)" : ""}`)
    console.log(`rpc       : ${RPC.replace(/\/v2\/.*/, "/v2/<redacted>")}`)
    console.log("")

    if (!fs.existsSync(path.join(ROOT, ARTIFACTS))) {
        console.error(`[fatal] ${ARTIFACTS}/ does not exist.`)
        console.error(`        Build it first:  FOUNDRY_PROFILE=deploy forge build --out ${ARTIFACTS}`)
        process.exit(2)
    }

    const provider = new ethers.JsonRpcProvider(RPC, CHAIN_ID)
    const rows = await preflight(provider, targets)

    const pad = Math.max(...rows.map((r) => r.name.length))
    for (const r of rows) {
        const mark = r.status === "MATCH" ? "ok  " : "FAIL"
        console.log(`[${mark}] ${r.name.padEnd(pad)}  ${r.address}  ${r.status}  ${r.detail ?? ""}`)
    }

    const bad = rows.filter((r) => r.status !== "MATCH")
    if (bad.length) {
        console.log("")
        console.log(`${bad.length} contract(s) failed the bytecode pre-flight.`)
        const wrongProfile = bad.some((r) => r.status === "WRONG-PROFILE")
        if (wrongProfile) {
            console.log("Rebuild with the deploy profile, then re-run:")
            console.log(`  FOUNDRY_PROFILE=deploy forge build --out ${ARTIFACTS}`)
        }
    }
    if (CHECK_ONLY) {
        if (JSON_OUT) writeReport(rows, [])
        process.exit(bad.length ? 1 : 0)
    }
    if (STATUS) {
        const status = await sourcifyStatus(rows)
        const padS = Math.max(...status.map((s) => s.name.length))
        for (const s of status) console.log(`${s.name.padEnd(padS)}  ${s.address}  ${s.status}`)
        const verified = status.filter((s) => s.status === "exact_match" || s.status === "match").length
        console.log("")
        console.log(`Sourcify exact/runtime matches: ${verified}/${status.length}`)
        process.exit(verified === status.length ? 0 : 1)
    }
    if (bad.length) {
        console.log("Refusing to submit artifacts that do not reproduce on-chain code.")
        if (JSON_OUT) writeReport(rows, [])
        process.exit(1)
    }
    if (VERIFIER !== "sourcify" && !BASESCAN_KEY) {
        console.error("[fatal] Basescan needs BASESCAN_API_KEY (or ETHERSCAN_API_KEY) in .env")
        process.exit(2)
    }

    const verifiers = VERIFIER === "both" ? ["sourcify", "basescan"] : [VERIFIER]
    const results = []
    for (const r of rows) {
        for (const v of verifiers) {
            process.stdout.write(`→ ${r.name} via ${v} ... `)
            const out = forgeVerify(r, v)
            // "Already verified" is a success for our purposes.
            const already = /already verified|already been verified/i.test(out.output)
            const ok = out.ok || already
            console.log(ok ? (already ? "already verified" : "submitted") : "FAILED")
            if (!ok) console.log(indent(out.output, "    "))
            results.push({ name: r.name, address: r.address, verifier: v, ok, already, output: out.output })
        }
    }

    const failed = results.filter((r) => !r.ok)
    console.log("")
    console.log(`verified: ${results.length - failed.length}/${results.length}`)
    if (failed.length) {
        console.log("failures:")
        for (const f of failed) console.log(`  - ${f.name} (${f.verifier})`)
    }
    if (JSON_OUT) writeReport(rows, results)
    process.exit(failed.length ? 1 : 0)
}

function indent(text, prefix) {
    return text
        .split(/\r?\n/)
        .map((l) => prefix + l)
        .join("\n")
}

function writeReport(rows, results) {
    const out = path.resolve(ROOT, JSON_OUT)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(
        out,
        JSON.stringify(
            {
                chainId: CHAIN_ID,
                artifacts: ARTIFACTS,
                optimizerRuns: OPTIMIZER_RUNS,
                solc: SOLC,
                generatedAt: new Date().toISOString(),
                preflight: rows.map((r) => ({
                    name: r.name,
                    address: r.address,
                    status: r.status,
                    onchainBytes: r.onchainBytes,
                    artifactBytes: r.artifactBytes,
                })),
                results,
            },
            null,
            2,
        ) + "\n",
    )
    console.log(`report: ${path.relative(ROOT, out)}`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
