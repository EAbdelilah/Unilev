/**
 * Shared HTTP plumbing for the intent relay routes.
 *
 * Every response is JSON with permissive CORS: solvers are third parties who
 * call this from their own origin, and the payload is public data.
 */

export const MAX_BODY = Number(process.env.RELAY_MAX_BODY ?? 32768)

const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
}

export function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...CORS },
    })
}

export function preflight() {
    return new Response(null, { status: 204, headers: CORS })
}

/** Parses a JSON request body, enforcing the size cap. Throws `{status}`. */
export async function readJson(request) {
    const text = await request.text()
    if (text.length > MAX_BODY) throw Object.assign(new Error("body too large"), { status: 413 })
    try {
        return JSON.parse(text || "{}")
    } catch {
        throw Object.assign(new Error("body is not valid JSON"), { status: 400 })
    }
}

/** Turns any thrown value into a JSON error response. */
export function fail(e) {
    const status = typeof e?.status === "number" ? e.status : 500
    return json({ error: e?.message ?? "internal error" }, status)
}
