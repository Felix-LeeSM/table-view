// #1077 admin-parity Stage 3 (2026-07-25) — shared primitives that promote
// the connection ops snapshot panels (ServerActivity / SlowQuery) into
// auto-polling dashboards with a lightweight session-local trend.
//
// Backend is unchanged: these only drive the existing admin-ops IPC on a
// timer and keep a small in-memory history of a single numeric metric.

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fire `callback` every `intervalMs` while `enabled`. The latest callback
 * is read through a ref so a changing closure (e.g. a `refresh` that closes
 * over new state) never restarts the timer — only `enabled` / `intervalMs`
 * do. Cleared on unmount, which is how an inactive/closed ops tab stops
 * hammering the server (OperationsPanel unmounts non-active tabs).
 */
export function useAutoRefresh(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => cbRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}

/**
 * Session-local ring buffer of the last `capacity` numeric samples, used to
 * back the ops dashboards' sparklines. Resets whenever `resetKey` changes
 * (e.g. the driving connection) so one connection's history never bleeds
 * into another's.
 *
 * ponytail: samples live ONLY in this in-memory, session-local buffer and
 * are never written to disk/DB. Persisting activity/slow-query history
 * would cross the ADR 0036 (telemetry-zero-collection) / ADR 0042
 * (query-history privacy) boundary — that is a separate owner decision and
 * is deliberately out of this slice.
 */
export function useTrendBuffer(
  capacity: number,
  resetKey: string,
): { samples: number[]; push: (value: number) => void } {
  const [samples, setSamples] = useState<number[]>([]);
  const bufRef = useRef<number[]>([]);

  useEffect(() => {
    bufRef.current = [];
    setSamples([]);
  }, [resetKey]);

  const push = useCallback(
    (value: number) => {
      const next = [...bufRef.current, value].slice(-capacity);
      bufRef.current = next;
      setSamples(next);
    },
    [capacity],
  );

  return { samples, push };
}
