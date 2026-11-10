/** Typed error taxonomy for the Eswap AgentKit provider (no `any`, no bare throws). */
export class EswapProviderError extends Error {
  public readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EswapProviderError";
    this.code = code;
  }
}
