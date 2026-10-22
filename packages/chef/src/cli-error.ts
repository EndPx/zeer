export class CliError extends Error {
  constructor(readonly code: string) { super(code); }
}
