import { ScaffoldError, validateProjectName, validateStartHeight } from "./scaffold.js";
import { PrepClient } from "@zeer-dev/prep-client";
import type { Height } from "@zeer-dev/prep-client";

export const PUBLIC_TESTNET_PREP = "https://zeer.endpx.cloud/api/prep";

export type InitAnswers = { directory?: string; project?: string; startHeight?: string };

function height(value: string): void {
  if (value === "latest") return;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new ScaffoldError("INVALID_START_HEIGHT");
  validateStartHeight(Number(value));
}

export function initPrepUrl(value: string): string {
  try {
    new PrepClient({ url: value });
    return new URL(value).href.replace(/\/$/, "");
  } catch { throw new ScaffoldError("INVALID_PREP_URL"); }
}

export async function resolveStartHeight(value: string, options: {
  url: string; token?: string; signal?: AbortSignal; client?: Pick<PrepClient, "getHeight">;
}): Promise<number> {
  height(value);
  if (value !== "latest") return Number(value);
  let meta: Height;
  try {
    meta = await (options.client ?? new PrepClient({ url: options.url, token: options.token }))
      .getHeight({ timeoutMs: 5000, signal: options.signal });
  } catch {
    options.signal?.throwIfAborted();
    throw new ScaffoldError("INIT_PREP_UNAVAILABLE");
  }
  if (!meta.ready || meta.network !== "testnet" || meta.payload_kind !== "full-v1"
    || !Number.isInteger(meta.archive_height) || meta.archive_height === null
    || meta.archive_height < meta.start_block) throw new ScaffoldError("INIT_PREP_NOT_READY");
  validateStartHeight(meta.archive_height);
  return meta.archive_height;
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
  const startHeight = supplied.startHeight ?? await question("Start block: latest indexed or a height", "latest", height);
  return { project, directory, startHeight };
}
