/** Typed error taxonomy for the Eswap AgentKit provider (no `any`, no bare throws). */
export class EswapProviderError extends Error {
    constructor(code, message, options) {
        super(message, options);
        this.name = "EswapProviderError";
        this.code = code;
    }
}
