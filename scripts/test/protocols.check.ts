/**
 * scripts/test/protocols.check.ts
 * Verifies the supply-venue protocol facts against the OFFICIAL SDKs.
 * =================================================================
 * These are the assertions that would have caught the earlier round of invented
 * venue wiring:
 *
 *   - UniswapX reactors on Unichain are read from the SDK map, and a zero
 *     address is reported as ABSENT (Dutch V1/V2 are not deployed on 130).
 *   - 1inch Fusion+ recognises Unichain and exposes a real escrow factory.
 *   - Each venue's destination-settlement model is what we claim it is, so
 *     EswapSettlement.fill is NOT assumed to work for UniswapX or 1inch.
 *
 * Run: npx tsx scripts/test/protocols.check.ts
 */
import { strict as assert } from "node:assert";
import {
    ACROSS_REST,
    ONEINCH_FUSION_REST,
    SETTLEMENT_MODEL,
    UNISWAPX_REST,
    fusionDeployment,
    uniswapXDeployment,
} from "../lib/protocols.js";
import { UNICHAIN_CHAIN_ID } from "../lib/types.js";

const ZERO = "0x0000000000000000000000000000000000000000";
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

let passed = 0;
function check(name: string, fn: () => void): void {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
}

console.log("Supply-venue protocol facts (Unichain, chain 130)\n");

const ux = uniswapXDeployment(UNICHAIN_CHAIN_ID);

check("UniswapX has at least one live reactor on Unichain", () => {
    assert.ok(ux.supportedOrderTypes.length > 0, "no UniswapX reactor deployed on chain 130");
});

check("zero-address reactors are excluded (Dutch V1/V2 not on Unichain)", () => {
    for (const type of ux.supportedOrderTypes) {
        assert.notEqual(ux.reactors[type], ZERO, `${type} reported as supported but is the zero address`);
    }
    for (const [type, addr] of Object.entries(ux.reactors)) {
        assert.match(addr as string, ADDR_RE, `${type} is not a valid address`);
    }
});

check("UniswapX Dutch_V3 reactor is the documented Unichain address", () => {
    const v3 = ux.reactors.Dutch_V3;
    assert.ok(v3 !== undefined, "Dutch_V3 reactor missing on Unichain");
    assert.equal(v3, "0x000000005aF66799D1a6317714D66800f9CA1406");
});

const fusion = fusionDeployment(UNICHAIN_CHAIN_ID);

check("1inch Fusion+ recognises Unichain", () => {
    assert.equal(fusion.supported, true);
    assert.equal(fusion.networkName, "UNICHAIN");
});

check("1inch Fusion+ escrow factory resolves to a real address", () => {
    assert.ok(fusion.escrowFactory !== undefined, "escrow factory missing on Unichain");
    assert.match(fusion.escrowFactory, ADDR_RE);
});

check("settlement models match each venue's real on-chain entrypoint", () => {
    // EswapSettlement.fill(bytes32,bytes,bytes) is only usable for venues whose
    // destination fill is an ERC-7683 fill. UniswapX executes on a reactor and
    // 1inch withdraws from an escrow, so neither may claim erc7683-fill.
    assert.equal(SETTLEMENT_MODEL.cow, "erc7683-fill");
    assert.equal(SETTLEMENT_MODEL.across, "erc7683-fill");
    assert.equal(SETTLEMENT_MODEL.uniswapx, "reactor-execute");
    // EswapOneInchFusionSettlement settles classic Fusion through the Limit Order
// Protocol's IPostInteraction callback. Fusion+ escrow withdrawal is a separate,
// unimplemented model — see SETTLEMENT_MODEL in protocols.ts.
assert.equal(SETTLEMENT_MODEL.oneinchfusion, "lop-postinteraction");
});

check("REST endpoints match protocol documentation", () => {
    // Across exposes a quote+prebuilt-calldata endpoint, NOT an order-create.
    assert.equal(ACROSS_REST.quote, "/swap/approval");
    assert.ok(!Object.keys(ACROSS_REST).some((k) => k.includes("create")));
    assert.equal(UNISWAPX_REST.submit, "https://trade-api.gateway.uniswap.org/v1/order");
    assert.equal(ONEINCH_FUSION_REST.submit, "/v1.2/submit");
});

console.log(`\n  ${passed} protocol assertions passed.`);
console.log("  UniswapX order types live on Unichain:", ux.supportedOrderTypes.join(", "));
console.log("  NOTE: a venue is only FILLABLE once a settler contract speaks its model");
console.log("        (erc7683-fill | reactor-execute | lop-postinteraction | escrow-withdraw) and is whitelisted");
console.log("        via router.setSolverWhitelist().");
