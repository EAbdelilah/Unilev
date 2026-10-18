/**
 * scripts/test/cowCommitment.check.ts
 * Verifies the off-chain `leverageCommitment()` mirror against the on-chain
 * `EswapCoWSettlement.leverageCommitment(uint8)` vectors asserted in
 * `src/v4/test/EswapCoWSettlementTest.t.sol::test_AppDataLeverageCommitment_MatchesOffchainMirror`.
 *
 * This exists because the drift guard was only claimed, not real: the doc
 * comment pointed at "scripts/lib/cowCommitment.test.ts", which did not exist,
 * and no test runner was wired for scripts/ at all. The check also pins down the
 * canonical `fullAppData` document, which is easy to get wrong -- any
 * whitespace/field-order change would hash to a different, unfillable CoW
 * appData.
 *
 * Run: npm run test:cow-commitment
 */
import { APP_DATA_LEVERAGE_TAG, appDataJson, leverageCommitment } from "../lib/types.js";

/** keccak256("eswap-cow-leverage-v1"), restated so drift is caught here too. */
const EXPECTED_TAG = "0x18eab004642389f43b01034a794cd7a5fb4599ec6c5554f5c3dc71ee56d5f2ec";

/** Canonical document, restated so serialisation drift is caught here too. */
const EXPECTED_JSON_2 = '{"version":1,"appCode":"eswap","metadata":{"eswapLeverage":"2"}}';

/** On-chain vectors, copied from the Solidity test. */
const ONCHAIN: ReadonlyArray<readonly [number, string]> = [
    [1, "0xbcc792a77d7d03f09008758edfeda2595d74f87c77b00e8acaadd1b6218aeef9"],
    [2, "0xe41487c9526647cd735c32eb215d78c1ede38b416a351fb6eb4a75c321291bfb"],
    [3, "0xfa394a0e92a144ac7060e7dfb11e2d7387898d1c7905536a744b13cdf68cb215"],
    [5, "0x0e6bbd5b034bb4498818f2aeeebeee214a0a31599937ed81baa6b230c859dbb3"],
    [10, "0x1bbd6237ee4b231ae6b3ac6c20ecc54294ad76a6ee9559d5d99cf1cdef5a24da"],
    [20, "0xab21c0923157bc697ecb0109b7ea272b89f35fe3a390943ffb311473dd0fea27"],
];

let failures = 0;

if (appDataJson(2) !== EXPECTED_JSON_2) {
    console.error(`  x appDataJson(2) drifted: ${appDataJson(2)}`);
    failures++;
} else {
    console.log("  + appDataJson(2) matches the canonical fullAppData document");
}

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
