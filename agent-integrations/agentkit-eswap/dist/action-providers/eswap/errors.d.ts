/** Typed error taxonomy for the Eswap AgentKit provider (no `any`, no bare throws). */
export declare class EswapProviderError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=errors.d.ts.map