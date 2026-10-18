export type ConsoleStatus = {
  checkedAt?: string;
  prep: { configured: boolean; available?: boolean; data?: Record<string, unknown> | null };
  chef: { configured: boolean; available?: boolean; data?: Record<string, unknown> | null };
  recentBlocks?: { height: number; hash: string; time: number }[];
  recentBlocksAvailable?: boolean;
};

function height(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function syncMetrics(status: ConsoleStatus | null, now = Date.now()) {
  const prep = status?.prep.available ? status.prep.data : null;
  const start = height(prep?.start_block), head = height(prep?.indexed_height);
  const observed = height(prep?.source_observed_at);
  const fresh = observed !== null && now / 1000 - observed >= -5 && now / 1000 - observed <= 120;
  const tip = prep?.ready === true && prep.source_mode === "follower" && fresh ? height(prep.source_height) : null;
  const count = start !== null && head !== null && head >= start ? head - start + 1 : null;
  const consistentTip = tip !== null && head !== null && tip >= head;
  const total = consistentTip ? tip + 1 : null;
  const checkpoint = status?.chef.available ? height(status.chef.data?.height) : null;
  const compatible = count !== null && start !== null && head !== null && checkpoint !== null && checkpoint >= start - 1 && checkpoint <= head;
  const chefCount = compatible ? checkpoint - start! + 1 : null;
  return { start, head, tip: consistentTip ? tip : null, count, total, checkpoint,
    historyPercent: count !== null && total !== null ? count / total * 100 : null,
    chefPercent: chefCount !== null && count ? chefCount / count * 100 : null,
    chefCount, sourceLag: consistentTip ? tip - head! : null,
    chefLag: compatible ? head! - checkpoint! : null,
    following: prep?.ready === true && prep.source_mode === "follower" && consistentTip,
  };
}

export function percentLabel(value: number | null) {
  if (value === null) return "Unknown";
  if (value === 100) return "100%";
  if (value > 0 && value < 0.001) return "<0.001%";
  return `${Math.min(99.999, value).toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}
