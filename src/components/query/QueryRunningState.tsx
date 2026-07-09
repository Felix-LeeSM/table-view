import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

/**
 * Issue #1057 — formats an elapsed duration for the running-state timer.
 * < 60s shows one decimal ("12.3s"); >= 60s switches to "1m 23s" so a
 * multi-minute query stays readable without a growing decimal.
 */
function formatElapsed(ms: number): string {
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)}s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  return `${m}m ${s}s`;
}

const SLOW_THRESHOLD_MS = 10_000;

/**
 * Issue #1057 — live elapsed-time display shown while a query runs. Ticks
 * every 100ms via `setInterval`; the interval is owned by this component
 * (mounted only during the running branch of QueryResultGrid) so it clears
 * automatically on state transition. `startedAt` comes from the store so it
 * survives tab switches / remounts; if absent (tests constructing state
 * directly) it falls back to mount time.
 *
 * (선택 AC) After 10s the text shifts to the warning color to nudge the
 * user toward Cancel — same visual severity signal used elsewhere for
 * "attention needed" without a separate alert.
 */
export function QueryRunningState({ startedAt }: { startedAt?: number }) {
  const { t } = useTranslation("query");
  const startRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const anchor = startedAt ?? startRef.current;
  const elapsedMs = Math.max(0, now - anchor);
  const slow = elapsedMs >= SLOW_THRESHOLD_MS;
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-1 flex-col items-center justify-center"
    >
      <Loader2
        className="mb-2 animate-spin text-muted-foreground"
        size={24}
        aria-hidden="true"
      />
      <p
        className={
          slow ? "text-sm text-warning" : "text-sm text-muted-foreground"
        }
      >
        {t("resultGrid.executing")} {formatElapsed(elapsedMs)}
      </p>
    </div>
  );
}

export default QueryRunningState;
