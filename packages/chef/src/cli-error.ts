export class CliError extends Error {
  readonly retryTransient: boolean;
  constructor(readonly code: string, options?: { retryTransient?: boolean }) {
    super(code);
    // A normalized diagnostic hint only; it never authorizes a retry or carries
    // a third-party action/string across the status -> terminal-error boundary.
    this.retryTransient = code === "SOURCE_UNAVAILABLE" && options?.retryTransient === true;
  }
}
