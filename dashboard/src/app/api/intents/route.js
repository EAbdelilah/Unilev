/**
 * GET  /api/intents[?status=open]  — solver feed of fillable intents.
 * POST /api/intents                — submit {order, scheme, signature}.
 *
 * Listing is gated on an on-chain check (signature recovery, unfilled status,
 * USDC/WETH pair, leverage commitment, and the owner's real balance/allowance),
 * so a listed intent is one a solver can actually fill without fronting margin.
 *
 * See `dashboard/src/lib/intents.js` for the trust model and the storage caveat.
 */
import { fail, json, preflight, readJson } from "./_http"
import { listIntents, publicView, submitIntent } from "@/lib/intents"

// The book is mutable state; never let Next cache these responses.
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function OPTIONS() {
    return preflight()
}

export async function GET(request) {
    try {
        const status = new URL(request.url).searchParams.get("status")
        return json(listIntents(status))
    } catch (e) {
        return fail(e)
    }
}

export async function POST(request) {
    try {
        const body = await readJson(request)
        const { created, record } = await submitIntent(body)
        return json(publicView(record), created ? 201 : 200)
    } catch (e) {
        return fail(e)
    }
}
