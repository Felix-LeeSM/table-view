// Sprint 340 (2026-05-15) — U5 live wire. Replaces the
// BackendPendingPlaceholder with a paradigm-neutral top-N slow query
// table sourced from `pg_stat_statements` (RDB) or `system.profile`
// (Mongo). `limit` is fixed at 25 for the initial wire; a follow-up
// sprint can add a selector once usage tells us what range matters.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { slowQueries, type SlowQueryRow } from "@/lib/api/slowQueries";
import { safeStringifyCell } from "@/lib/jsonCell";

export interface SlowQueryPanelProps {
  connectionId: string;
  paradigm: "table" | "document";
}

const DEFAULT_LIMIT = 25;

export function SlowQueryPanel({
  connectionId,
  paradigm,
}: SlowQueryPanelProps) {
  const [rows, setRows] = useState<SlowQueryRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await slowQueries(connectionId, DEFAULT_LIMIT);
      setRows(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <section
      aria-label="Slow queries"
      data-paradigm={paradigm}
      data-testid="slow-query-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Slow queries —{" "}
          {paradigm === "table" ? "pg_stat_statements" : "system.profile"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="slow-query-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          Refresh
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="slow-query-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && rows !== null && rows.length === 0 && (
        <div
          data-testid="slow-query-empty"
          className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          {paradigm === "document"
            ? "system.profile is empty. Enable Mongo profiling with db.setProfilingLevel(level, slowms)."
            : "pg_stat_statements returned no rows yet. Run some queries first."}
        </div>
      )}

      {!loading && error === null && rows !== null && rows.length > 0 && (
        <table data-testid="slow-query-table" className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="px-1 py-1 font-medium">Query</th>
              <th className="px-1 py-1 font-medium">Calls</th>
              <th className="px-1 py-1 font-medium">Mean (ms)</th>
              <th className="px-1 py-1 font-medium">Total (ms)</th>
              <th className="px-1 py-1 font-medium">Rows</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={`${row.query.slice(0, 64)}-${idx}`}
                className="border-t border-border/50"
              >
                <td
                  className="max-w-md truncate px-1 py-1 font-mono"
                  title={row.query}
                >
                  {row.query}
                </td>
                <td className="px-1 py-1 font-mono">
                  {row.calls.toLocaleString()}
                </td>
                <td className="px-1 py-1 font-mono">
                  {row.meanExecTimeMs.toFixed(2)}
                </td>
                <td className="px-1 py-1 font-mono">
                  {row.totalExecTimeMs.toFixed(2)}
                </td>
                <td className="px-1 py-1 font-mono">
                  {row.rows.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading &&
        error === null &&
        rows !== null &&
        rows[0] !== undefined &&
        Object.keys(rows[0].extras).length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Raw extras (first row)</summary>
            <pre
              data-testid="slow-query-extras"
              className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono"
            >
              {safeStringifyCell(rows[0].extras, 2)}
            </pre>
          </details>
        )}
    </section>
  );
}
