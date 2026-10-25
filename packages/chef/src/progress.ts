import type { RuntimePhase, RuntimeProgressEvent } from "./runtime.js";

export interface ProgressSnapshot {
  phase: RuntimePhase;
  phaseSince: string;
  lastProgressAt: string | null;
  heartbeatAt: string;
  committedHeight: number | null;
  processingRange: { from: number; to: number } | null;
  prepArchiveHeight: number | null;
  prepIndexedHeight: number | null;
  prepReady: boolean | null;
  sourceObservedHeight: number | null;
  sourceObservedAt: number | null;
}

/** Cached process diagnostics. Polling the snapshot never reads Prep or PostgreSQL. */
export function createProgressTracker(committedHeight: number | null, now: () => string = () => new Date().toISOString()) {
  let state: Omit<ProgressSnapshot, "heartbeatAt"> = {
    phase: "checking_checkpoint", phaseSince: now(), lastProgressAt: null,
    committedHeight, processingRange: null, prepArchiveHeight: null, prepIndexedHeight: null,
    prepReady: null, sourceObservedHeight: null, sourceObservedAt: null,
  };
  return {
    update(event: Readonly<RuntimeProgressEvent>): void {
      const at = now();
      const { progressed, phase, ...known } = event;
      state = { ...state, ...known, phase, phaseSince: phase === state.phase ? state.phaseSince : at,
        lastProgressAt: progressed ? at : state.lastProgressAt,
        processingRange: event.processingRange === undefined ? state.processingRange : event.processingRange === null ? null : { ...event.processingRange } };
    },
    snapshot(): ProgressSnapshot {
      return { ...state, processingRange: state.processingRange ? { ...state.processingRange } : null, heartbeatAt: now() };
    },
  };
}

/** Synchronous bounded heartbeat: no overlapping writes, rejected promises, or cleanup races. */
export function startProgressHeartbeat(emit: () => void, intervalMs = 5000, writable: () => boolean = () => true): () => void {
  const timer = setInterval(() => {
    // Output may close while the worker is still unwinding. It must not change indexing.
    try { if (writable()) emit(); } catch { /* diagnostic output is best effort */ }
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
