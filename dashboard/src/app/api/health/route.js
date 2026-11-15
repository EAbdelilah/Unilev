/**
 * GET /api/health — liveness probe for uptime monitors and solver pre-flight.
 * Reports the chain the relay is pinned to and the size of the local book.
 */
import { json } from "../intents/_http"
import { CHAIN_ID, INTENTS_ENV, listIntents } from "@/lib/intents"

export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
    return json({
        ok: true,
        chainId: CHAIN_ID,
        intents: listIntents().length,
        limits: INTENTS_ENV,
        service: "eswap-intent-relay",
    })
}
