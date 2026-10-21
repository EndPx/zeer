import { ScaffoldError, validateProjectName, validateStartHeight } from "./scaffold.js";

export type InitAnswers = { directory?: string; project?: string; startHeight?: string };

function height(value: string): void {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new ScaffoldError("INVALID_START_HEIGHT");
  validateStartHeight(Number(value));
}

/** Collect all answers before the scaffold can write files. */
export async function collectInitAnswers(
  supplied: InitAnswers,
  ask: (question: string) => Promise<string>,
  invalid: (code: string) => void,
): Promise<Required<InitAnswers>> {
  if (supplied.project !== undefined) validateProjectName(supplied.project);
  if (supplied.startHeight !== undefined) height(supplied.startHeight);
  async function question(label: string, fallback: string, validate?: (value: string) => void): Promise<string> {
    for (;;) {
      const answer = (await ask(`${label} (${fallback}): `)).trim() || fallback;
      try { validate?.(answer); return answer; }
      catch (error) {
        if (!(error instanceof ScaffoldError)) throw error;
        invalid(error.code);
      }
    }
  }
  const project = supplied.project ?? await question("Project name", "my_indexer", validateProjectName);
  const directory = supplied.directory ?? await question("Project folder", project.replaceAll("_", "-"));
  const startHeight = supplied.startHeight ?? await question("Start block", "0", height);
  return { project, directory, startHeight };
}
