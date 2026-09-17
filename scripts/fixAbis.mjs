import { readFileSync, writeFileSync } from "node:fs";
import { parseAbi } from "viem";

const FILE = "lib/abis.ts";
const SRC = readFileSync(FILE, "utf8");

const POOL_KEY_SHAPE = ["address", "address", "uint24", "int24", "address"];

function isPoolKeyComponents(c) {
    return (
        Array.isArray(c) &&
        c.length === 5 &&
        c.every((x, i) => x && x.type === POOL_KEY_SHAPE[i])
    );
}

/** Returns a JS source string for a viem param, replacing PoolKey tuple
 *  components with a reference to the already-exported poolKeyComponents. */
function renderParam(p) {
    const namePart = p.name ? `name: ${JSON.stringify(p.name)}, ` : "";
    if (p.type === "tuple" && isPoolKeyComponents(p.components)) {
        return `{ ${namePart}type: "tuple", components: poolKeyComponents }`;
    }
    if (p.type === "tuple" && Array.isArray(p.components)) {
        const inner = p.components.map(renderParam).join(", ");
        return `{ ${namePart}type: "tuple", components: [${inner}] }`;
    }
    const indexed = p.indexed ? `indexed: true, ` : "";
    return `{ ${namePart}type: ${JSON.stringify(p.type)}${indexed ? `, ${indexed}` : ""} }`;
}

function renderItem(item) {
    const out = [`{`, `    type: ${JSON.stringify(item.type)},`];
    if (item.name) out.push(`    name: ${JSON.stringify(item.name)},`);
    if (item.inputs) out.push(`    inputs: [`, ...item.inputs.map((x) => `        ${renderParam(x)},`), `    ],`);
    if (item.outputs) out.push(`    outputs: [`, ...item.outputs.map((x) => `        ${renderParam(x)},`), `    ],`);
    if (item.stateMutability) out.push(`    stateMutability: ${JSON.stringify(item.stateMutability)},`);
    if (item.anonymous) out.push(`    anonymous: true,`);
    out.push(`}`);
    return out.join("\n");
}

function convertBlock(name) {
    const marker = `export const ${name} = parseAbi([`;
    const start = SRC.indexOf(marker);
    if (start === -1) throw new Error(`block not found: ${marker}`);
    const open = SRC.indexOf("[", start) + 1;
    const close = SRC.indexOf("]);", open);
    const body = SRC.slice(open, close);

    // Pull each human-readable string literal from the list.
    const strings = [];
    const re = /"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(body)) !== null) strings.push(m[1]);

    const items = strings.map((s) => parseAbi([s])[0]);
    const rendered = items.map(renderItem).map((s) => s.split("\n").join("\n")).join(",\n");
    const blockSrc = `export const ${name} = [\n${rendered},\n] as const;`;
    return { start, end: close + 2, blockSrc };
}

// Rebuild the file, replacing both in one pass (bottom-up so indices stay valid).
const jobs = ["marginHookAbi", "quoterAbi"].map(convertBlock);
let out = SRC;
for (const j of [...jobs].reverse()) out = out.slice(0, j.start) + j.blockSrc + out.slice(j.end);
writeFileSync(FILE, out);

console.log("ok: converted marginHookAbi + quoterAbi to object form (poolKeyComponents)");
