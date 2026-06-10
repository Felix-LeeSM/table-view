// Sprint 336 (2026-05-15) — U1 live wire. Server activity (PG
// pg_stat_activity / Mongo db.currentOp) + Kill action. Wire shape is
// paradigm-neutral so the grid renders both sides identically.

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  killServerActivity,
  listServerActivity,
  type ServerActivityRow,
} from "@/lib/api/serverActivity";

export interface ServerActivityPanelProps {
  connectionId: string;
  paradigm: "table" | "document";
}

export function ServerActivityPanel({
  connectionId,
  paradigm,
}: ServerActivityPanelProps) {
  const [rows, setRows] = useState<ServerActivityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [killingId, setKillingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listServerActivity(connectionId);
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

  const handleKill = useCallback(
    async (id: number) => {
      setKillingId(id);
      try {
        await killServerActivity(connectionId, id);
        await refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setKillingId(null);
      }
    },
    [connectionId, refresh],
  );

  return (
    <section
      aria-label="Server activity"
      data-paradigm={paradigm}
      data-testid="server-activity-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Server activity ({paradigm === "table" ? "PG" : "Mongo"})</span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="server-activity-refresh"
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
          data-testid="server-activity-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && rows.length === 0 && (
        <p
          role="status"
          data-testid="server-activity-empty"
          className="px-3 py-2 text-xs italic text-muted-foreground"
        >
          No active sessions.
        </p>
      )}

      {rows.length > 0 && (
        <table
          aria-label="Server activity grid"
          data-testid="server-activity-grid"
          className="w-full border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-border bg-secondary text-left text-muted-foreground">
              <th className="px-3 py-1 font-medium">ID</th>
              <th className="px-3 py-1 font-medium">DB</th>
              <th className="px-3 py-1 font-medium">User</th>
              <th className="px-3 py-1 font-medium">State</th>
              <th className="px-3 py-1 font-medium">Wait</th>
              <th className="px-3 py-1 font-medium">Query</th>
              <th className="px-3 py-1 font-medium">Started</th>
              <th className="px-3 py-1 font-medium" aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border last:border-none"
              >
                <td className="px-3 py-1 font-mono">{r.id}</td>
                <td className="px-3 py-1">{r.db ?? "—"}</td>
                <td className="px-3 py-1">{r.user ?? "—"}</td>
                <td className="px-3 py-1">{r.state ?? "—"}</td>
                <td className="px-3 py-1">{r.waitEvent ?? "—"}</td>
                <td
                  className="px-3 py-1 max-w-md truncate"
                  title={r.query ?? ""}
                >
                  {r.query ?? "—"}
                </td>
                <td className="px-3 py-1">{r.startedAt ?? "—"}</td>
                <td className="px-3 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    data-testid={`server-activity-kill-${r.id}`}
                    onClick={() => void handleKill(r.id)}
                    disabled={killingId === r.id}
                  >
                    {killingId === r.id ? "Killing…" : "Kill"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
