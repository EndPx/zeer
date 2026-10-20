"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsoleStatus } from "./sync-status";

export function useConsoleStatus() {
  const [status, setStatus] = useState<ConsoleStatus | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/status", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]), cache: "no-store" });
      if (!r.ok) throw Error();
      const nextStatus = await r.json();
      if (!nextStatus.prep || !nextStatus.chef) throw Error();
      if (!controller.signal.aborted) {
        if ((nextStatus.prep.configured || nextStatus.chef.configured) && !nextStatus.prep.available && !nextStatus.chef.available) {
          setStatus(previous => previous ?? nextStatus);
          setError("The services did not respond. We will retry automatically; you can also press Refresh.");
        } else setStatus(nextStatus);
      }
    } catch {
      if (!controller.signal.aborted)
        setError("The status check could not finish. We will retry automatically; you can also press Refresh.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (pending.current === controller) pending.current = null;
    }
  }, []);
  useEffect(() => {
    void refresh();
    const visibleRefresh = () => { if (document.visibilityState === "visible" && !pending.current) void refresh(); };
    const timer = setInterval(visibleRefresh, 15000);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => { clearInterval(timer); pending.current?.abort(); document.removeEventListener("visibilitychange", visibleRefresh); };
  }, [refresh]);
  return { status, loading, error, refresh };
}
