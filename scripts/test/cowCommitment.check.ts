/**
 * scripts/test/cowCommitment.check.ts
 * Verifies the off-chain `leverageCommitment()` mirror against the on-chain
 * `EswapCoWSettlement.leverageCommitment(uint8)` vectors asserted in
 * `src/v4/test/EswapCoWSettlementTest.t.sol::test_AppDataLeverageCommitment_MatchesOffchainMirror`.
 *
 * This exists because the drift guard was only claimed, not real: the doc
 * comment pointed at "scripts/lib/cowCommitment.test.ts", which did not exist,
 * and no test runner was wired for scripts/ at all. The check also pins down the
 * 33-byte packed preimage, which is easy to get wrong -- an ABI-encoded
 * (32-byte-padded) uint8 would hash to a different, unfillable commitment.
 *
 * Run: npm run test:cow-commitment
 */
import { APP_DATA_LEVERAGE_TAG, leverageCommitment } from "../lib/types.js";

/** keccak256("eswap-cow-leverage-v1"), restated so drift is caught here too. */
const EXPECTED_TAG = "0x18eab004642389f43b01034a794cd7a5fb4599ec6c5554f5c3dc71ee56d5f2ec";

/** On-chain vectors, copied from the Solidity test. */
const ONCHAIN: ReadonlyArray<readonly [number, string]> = [
    [1, "0xe7d4bba9e5fc12c4267c2a71d03f126150b2ca090eed8ec302d617feedd83e7d"],
    [2, "0x5288929f74bcddb4e022c5b200ba5cef148a80cec9f2f76e2425fd90fad71440"],
    [3, "0x29311fe0d9acd6141a7f8f05a333769d3bd63bb47694b90e65c668159e4ce073"],
    [5, "0x9b0cb28eb51f758fc741c939cb2533401ffe905f9c75c16dd83082ddd5d3ca4a"],
    [10, "0x8c2b61c82aa73aab48db7f34770bfb80cd938251c51dcae30ef95e208ca3327e"],
    [20, "0xa070c0d19e203c748cd5e7074f7dc10c1cb6441779df057b773fd9aa57232641"],
];

let failures = 0;

if (APP_DATA_LEVERAGE_TAG.toLowerCase() !== EXPECTED_TAG.toLowerCase()) {
    console.error(`  x APP_DATA_LEVERAGE_TAG drifted: ${APP_DATA_LEVERAGE_TAG}`);
    failures++;
} else {
    console.log("  + APP_DATA_LEVERAGE_TAG matches keccak256('eswap-cow-leverage-v1')");
}

for (const [lev, expected] of ONCHAIN) {
    const got = leverageCommitment(lev) as string;
    if (got.toLowerCase() !== expected.toLowerCase()) {
        console.error(`  x leverage ${lev}: off-chain ${got} != on-chain ${expected}`);
        failures++;
    } else {
        console.log(`  + leverage ${lev} commitment matches`);
    }
}

// Every leverage the adapters accept (1..20) must encode to a distinct value,
// otherwise two different leverage orders would share an authorization.
const seen = new Map<string, number>();
for (let lev = 1; lev <= 20; lev++) {
    const c = (leverageCommitment(lev) as string).toLowerCase();
    const prior = seen.get(c);
    if (prior !== undefined) {
        console.error(`  x collision: leverage ${lev} and ${prior} share commitment ${c}`);
        failures++;
    }
    seen.set(c, lev);
}
if (failures === 0) console.log("  + commitments 1..20 are pairwise distinct");

if (failures > 0) {
    console.error(`\n${failures} commitment check(s) FAILED`);
    process.exit(1);
}
console.log("\nall CoW leverage-commitment checks passed");
