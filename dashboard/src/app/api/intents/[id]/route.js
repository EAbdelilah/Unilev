/**
 * GET /api/intents/:id — one intent. `:id` is the order-UID hash, i.e. the same
 * key the settlement's `filledOrders` mapping uses, so the relay id and the
 * on-chain id are the same identifier.
 */
import { fail, json, preflight } from "../_http"
import { getIntent, publicView } from "@/lib/intents"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function OPTIONS() {
    return preflight()
}

export async function GET(_request, { params }) {
    try {
        const { id } = await params
        const rec = getIntent(id)
        return rec ? json(publicView(rec)) : json({ error: "unknown intent" }, 404)
    } catch (e) {
        return fail(e)
    }
}
