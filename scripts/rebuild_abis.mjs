import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const F = resolve(__dirname, 'lib/abis.ts')
const ART = resolve(
    __dirname,
    '..',
    'out/EswapMarginHook.sol/EswapMarginHook.json'
)

const SRC = readFileSync(F, 'utf8')

// --- Head: byte-exact, ends right before the corrupt margin block. -----------
const HEAD_MARKER = 'export const marginHookAbi = ['
const hIdx = SRC.indexOf(HEAD_MARKER)
if (hIdx < 0) throw new Error('head marker missing')
const head = SRC.slice(0, hIdx) // lines 1..77, ends with line-77 newline

// --- Tail: byte-exact intact region (verified: quoter..leverageAdapter). -----
const TAIL_MARKER = 'export const quoterAbi = parseAbi(['
const tIdx = SRC.indexOf(TAIL_MARKER)
if (tIdx < 0) throw new Error('tail marker missing')
const tail = SRC.slice(tIdx) // lines 204..248 verbatim

// --- Regenerate ONLY the seven view functions used by the dashboard. ---------
const KEEP = new Set([
    'quoteOpenFit',
    'positions',
    'solverDebts',
    'openInterestCapacity',
    'maxTotalOIBps',
    'totalOpenInterestUSD',
    'maxLeverageByPool',
])

const POOLKEY_TYPES = ['address', 'address', 'uint24', 'int24', 'address']

function isPoolKeyTuple(c) {
    if (!Array.isArray(c) || c.length !== POOLKEY_TYPES.length) return false
    return c.every((x, i) => x.type === POOLKEY_TYPES[i])
}

const art = JSON.parse(readFileSync(ART, 'utf8'))

const fns = art.abi.filter(
    (x) =>
        x.type === 'function' &&
        KEEP.has(x.name) &&
        x.stateMutability === 'view'
)
if (fns.length !== KEEP.size) {
    throw new Error('margin view mismatch: expected ' + KEEP.size + ', got ' + fns.length)
}

function pad(n) {
    return '    '.repeat(n)
}

function renderParam(p, depth, outputs) {
    const o = { name: p.name ?? '' }

    if (isPoolKeyTuple(p.components)) {
        o.components = 'poolKeyComponents'
    } else if (Array.isArray(p.components)) {
        o.components = p.components.map((c) => renderParam(c, depth + 1))
    }

    o.type = isPoolKeyTuple(p.components) ? 'tuple' : p.type
    return pad(depth) + JSON.stringify(o) + ','
}

function renderFn(f) {
    const L = []
    L.push('    {')
    L.push('        type: "function",')
    L.push('        name: ' + JSON.stringify(f.name) + ',')
    if (f.inputs.length) {
        L.push('        inputs: [')
        for (const p of f.inputs) L.push(renderParam(p, 3))
        L.push('        ],')
    }
    if (f.outputs.length) {
        L.push('        outputs: [')
        for (const p of f.outputs) L.push(renderParam(p, 3))
        L.push('        ],')
    }
    L.push('        stateMutability: "view",')
    L.push('    },')
    return L.join('\n')
}

const block = []
block.push('/** EswapMarginHook view surface used by the dashboard. */')
block.push('export const marginHookAbi = [')
for (const f of fns) block.push(renderFn(f))
block.push('] as const;')
const marginBlock = block.join('\n')

const out = head + marginBlock + '\n\n' + tail
writeFileSync(F, out, 'utf8')

console.log(
    'ok: marginFns=' +
        fns.length +
        ' headBytes=' +
        Buffer.byteLength(head) +
        ' marginBytes=' +
        Buffer.byteLength(marginBlock) +
        ' tailBytes=' +
        Buffer.byteLength(tail) +
        ' total=' +
        Buffer.byteLength(out)
)
