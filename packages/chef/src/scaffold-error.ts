export class ScaffoldError extends Error {
  constructor(readonly code: string) { super(code); }
}
