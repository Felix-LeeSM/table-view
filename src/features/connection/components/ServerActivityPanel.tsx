// Sprint 336 (2026-05-15) — U1 live wire. Server activity (PG
// pg_stat_activity / Mongo db.currentOp) + Kill action. Wire shape is
// paradigm-neutral so the grid renders both sides identically.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  killServerActivity,
  listServerActivity,
  type ServerActivityRow,
} from "@/lib/api/serverActivity";
import { DATABASE_TYPE_LABELS, paradigmOf, type DatabaseType } from "../model";

export interface ServerActivityPanelProps {
  connectionId: string;
  dbType: DatabaseType;
}

export function ServerActivityPanel({
  connectionId,
  dbType,
}: ServerActivityPanelProps) {
  const { t } = useTranslation("featuresConnection");
  const paradigm = paradigmOf(dbType);
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
      aria-label={t("serverActivity.ariaSection")}
      data-paradigm={paradigm}
      data-testid="server-activity-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          {t("serverActivity.header", {
            paradigm: DATABASE_TYPE_LABELS[dbType],
          })}
        </span>
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
          {t("serverActivity.refresh")}
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
          {t("serverActivity.empty")}
        </p>
      )}

      {rows.length > 0 && (
        <table
          aria-label={t("serverActivity.ariaGrid")}
          data-testid="server-activity-grid"
          className="w-full border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-border bg-secondary text-left text-muted-foreground">
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colId")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colDb")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colUser")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colState")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colWait")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colQuery")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("serverActivity.colStarted")}
              </th>
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
                    {killingId === r.id
                      ? t("serverActivity.killing")
                      : t("serverActivity.kill")}
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
