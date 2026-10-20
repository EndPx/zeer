export type ChefDemo = { project: string; fromBlock: number; toBlock: number };

/** Operator-supplied target, never a substitute for an observed checkpoint. */
export function parseChefDemo(value: string | undefined): ChefDemo | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    if (!data || !/^[a-z][a-z0-9_]{0,31}$/.test(data.project) ||
        !Number.isSafeInteger(data.fromBlock) || data.fromBlock < 0 ||
        !Number.isSafeInteger(data.toBlock) || data.toBlock < data.fromBlock ||
        data.toBlock > 0xffff_fffe) return null;
    return { project: data.project, fromBlock: data.fromBlock, toBlock: data.toBlock };
  } catch { return null; }
}
