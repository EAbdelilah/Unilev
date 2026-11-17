/** Structured error surfaced by every Eswap integration. */
export class EswapError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;

    constructor(code: string, message: string, details: Record<string, unknown> = {}) {
        super(message);
        this.name = "EswapError";
        this.code = code;
        this.details = details;
    }

    toJSON(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            ...this.details,
        };
    }
}

export function normalizeEswapError(error: unknown): EswapError {
    if (error instanceof EswapError) return error;
    const message = error instanceof Error ? error.message : String(error);
    return new EswapError("UNKNOWN", message, {
        cause: error instanceof Error ? error.stack ?? error.name : undefined,
    });
}
