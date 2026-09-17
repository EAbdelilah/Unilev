import { readFileSync, writeFileSync } from 'node:fs'

// ---------------------------------------------------------------------------
// Reconstruct lib/abis.ts: splice byte-intact head + tail, and regenerate ONLY
// the marginHookAbi and quoterAbi blocks in object form (referencing
// poolKeyComponents so PoolKey tuples reconcile with the cowSettlementAbi uses).
// ---------------------------------------------------------------------------

const REPO = 'C:/Users/faar_/ESWAP/Unilev'
const F = REPO + '/scripts/lib/abis.ts'
const MH_ART = REPO + '/out/EswapMarginHook.sol/EswapMarginHook.json'
const QR_ART = REPO + '/out/EswapLeverageQuoter.sol/EswapLeverageQuoter.json'

const SRC = readFileSync(F, 'utf8')

// --- 1. Byte-exact markers in the current (line-number-stable) file ---------
const hIdx = SRC.indexOf('export const marginHookAbi = [') // starts line 78
const tIdx = SRC.indexOf('/** ERC-7683 destination settler') // line 210

if (hIdx < 0) throw new Error('head marker missing')
if (tIdx < 0) throw new Error('tail marker missing')

const head = SRC.slice(0, hIdx) // lines 1-77, ends after line 77's newline
const tail = SRC.slice(tIdx) // lines 210-248 (ERC-7683 comment onward)

// --- 2. Margin hook ABI (object form) from the artifact ----------------------
const mh = JSON.parse(readFileSync(MH_ART, 'utf8'))
const keepMH = new Set([
    'quoteOpenFit',
    'positions',
    'solverDebts',
    'openInterestCapacity',
    'maxTotalOIBps',
    'totalOpenInterestUSD',
    'maxLeverageByPool',
])

function isPoolKeyTuple(c) {
    return (
        Array.isArray(c) &&
        c.length === 5 &&
        c.every((x, i) => {
            const want = ['address', 'address', 'uint24', 'int24', 'address'][i]
            return x.type === want
        })
    )
}

function toParam(p, outer) {
    const o = { name: p.name ?? '', type: p.type }
    if (isPoolKeyTuple(p.components)) {
        o.components = outer ? poolKeyCompsInner : poolKeyCompsInner
    } else if (p.components) {
        o.components = p.components.map((c) => toParam(c, outer))
    }
    return o
}

const poolKeyCompsInner = [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
]

const poolKeyComps = [
    { name: 'currency0', type: 'address' },
    { name: 'currency1', type: 'address' },
    { name: 'fee', type: 'uint24' },
    { name: 'tickSpacing', type: 'int24' },
    { name: 'hooks', type: 'address' },
]

// Extract only the 7 view functions we keep, in artifact order.
let mhAbi = []
for (const it of mh.abi) {
    if (it.type !== 'function') continue
    if (!keepMH.has(it.name)) continue
    if ((it.stateMutability ?? '') !== 'view') continue
    mhAbi.push({
        type: 'function',
        name: it.name,
        inputs: (it.inputs ?? []).map((p) => toParam(p, true)),
        outputs: (it.outputs ?? []).map((p) => toParam(p, true)),
        stateMutability: 'view',
    })
}
if (mhAbi.length !== keepMH.size)
    throw new Error(
        'margin hook view functions mismatch: got ' + mhAbi.length
    )

function renderParam(p, indent) {
    const pad = '    '.repeat(indent)
    const comps = p.components
        ? ' components: ' +
          JSON.stringify(comps).replace(/"/g, "'")
        : ''
    return pad + '{ name: ' + JSON.stringify(p.name) + ', type: "' + p.type + '"' + comps + ' }'
}

function renderFn(f, indent) {
    const pad = '    '.repeat(indent)
    const lines = []
    lines.push(pad + '{')
    lines.push(pad + '    type: "function",')
    lines.push(pad + '    name: "' + f.name + '",')
    lines.push(pad + '    inputs: [')
    for (const p of f.inputs) lines.push(renderParam(p, indent + 2) + ',')
    lines.push(pad + '    ],')
    lines.push(pad + '    outputs: [')
    for (const p of f.outputs) lines.push(renderParam(p, indent + 2) + ',')
    lines.push(pad + '    ],')
    lines.push(pad + '    stateMutability: "view",')
    lines.push(pad + '},')
    return lines.join('\n')
}

const marginBlockLines = []
marginBlockLines.push('// EswapMarginHook view surface used by the dashboard (OI caps, solver')
marginBlockLines.push('// debts, per-pool leverage, indicative quotes).')
marginBlockLines.push('export const marginHookAbi = [')
const indent = 1
for (const f of mhAbi) {
    for (const l of renderFn(f, indent).split('\n')) marginBlockLines.push(l)
}
marginBlockLines.push('] as const;')
const marginBlock = marginBlockLines.join('\n')

// --- 3. Quoter ABI (object form) from the artifact ---------------------------
const qr = JSON.parse(readFileSync(QR_ART, 'utf8'))
const keepQR = new Set([
    'quoteExactInputSingleWithLeverage',
    'getPoolKey',
    'registerPool',
])
let qrAbi = []
for (const it of qr.abi) {
    if (it.type !== 'function') continue
    if (!keepQR.has(it.name)) continue
    qrAbi.push({
        type: 'function',
        name: it.name,
        inputs: (it.inputs ?? []).map((p) => toParam(p, false)),
        outputs: (it.outputs ?? []).map((p) => toParam(p, false)),
        stateMutability:
            it.stateMutability === 'view' ? 'view' : it.stateMutability ?? 'nonpayable',
    })
}
if (qrAbi.length !== keepQR.size)
    throw new Error('quoter functions mismatch: got ' + qrAbi.length)

function renderFnQ(f, indent) {
    const pad = '    '.repeat(indent)
    const lines = []
    lines.push(pad + '{')
    lines.push(pad + '    type: "function",')
    lines.push(pad + '    name: "' + f.name + '",')
    lines.push(pad + '    inputs: [')
    for (const p of f.inputs) lines.push(renderParam(p, indent + 2) + ',')
    lines.push(pad + '    ],')
    lines.push(pad + '    outputs: [')
    for (const p of f.outputs) lines.push(renderParam(p, indent + 2) + ',')
    lines.push(pad + '    ],')
    lines.push(pad + '    stateMutability: "' + f.stateMutability + '",')
    lines.push(pad + '},')
    return lines.join('\n')
}

const quoterBlockLines = []
quoterBlockLines.push('// EswapLeverageQuoter ABI (on-chain spot-with-leverage quoting + pool key').slice(0, 0)
quoterBlockLines.splice(0, 1)
quoterBlockLines.push('// EswapLeverageQuoter ABI: spot-with-leverage quoting + PoolKey helpers.')
quoterBlockLines.push('export const quoterAbi = [')
for (const f of qrAbi) {
    for (const l of renderFnQ(f, indent).split('\n')) quoterBlockLines.push(l)
}
quoterBlockLines.push('] as const;')
const quoterBlock = quoterBlockLines.join('\n')

// --- 4. Assemble -------------------------------------------------------------
const out = head + marginBlock + '\n\n' + quoterBlock + '\n\n' + tail
writeFileSync(F, out, 'utf8')

console.log(
    'ok: nodes=' +
        mhAbi.length +
        '+' +
        qrAbi.length +
        ' newBytes=' +
        Buffer.byteLength(out) +
        ' headBytes=' +
        Buffer.byteLength(head) +
        ' tailBytes=' +
        Buffer.byteLength(tail)
)
