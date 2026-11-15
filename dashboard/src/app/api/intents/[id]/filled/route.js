/**
 * POST /api/intents/:id/filled  — body `{ txHash? }`.
 *
 * Accepted only when `EswapCoWSettlement.filledOrders(id)` is true on Base.
 * That single condition is what makes the flag trustworthy: nobody can mark an
 * intent filled without the fill existing on chain, and the relay still never
 * signs or submits anything.
 */
import { fail, json, preflight, readJson } from "../../_http"
import { markFilled } from "@/lib/intents"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function OPTIONS() {
    return preflight()
}

export async function POST(request, { params }) {
    try {
        const { id } = await params
        const body = await readJson(request)
        return json(await markFilled(id, body?.txHash))
    } catch (e) {
        return fail(e)
    }
}
