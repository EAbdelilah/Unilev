const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

let enabled = false;

export function initSentry() {
    if (typeof window === "undefined") return;
    if (!SENTRY_DSN) return;
    enabled = true;
}

export function captureError(error, context) {
    if (!enabled || !SENTRY_DSN) {
        if (process.env.NODE_ENV === "development") {
            console.warn("[sentry] Error (DSN not configured):", error, context);
        }
        return;
    }
    try {
        const body = {
            exception: { values: [{ type: error.name, value: error.message, stacktrace: { frames: formatStack(error.stack) } }] },
            extra: context,
            timestamp: new Date().toISOString(),
            level: "error",
        };
        fetch(SENTRY_DSN, {
            method: "POST",
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
        }).catch(() => {});
    } catch {
    }
}

function formatStack(stack) {
    if (!stack) return [];
    return stack.split("\n").slice(1).map((line) => {
        const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
        if (match) {
            return { function: match[1], filename: match[2], lineno: parseInt(match[3]), colno: parseInt(match[4]) };
        }
        const match2 = line.match(/at\s+(.+?):(\d+):(\d+)/);
        if (match2) {
            return { filename: match2[1], lineno: parseInt(match2[2]), colno: parseInt(match2[3]) };
        }
        return { function: line.trim() };
    });
}
