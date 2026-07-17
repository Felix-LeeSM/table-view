// Issue #1077 Stage 2 (2026-07-06) — read-only users/roles panel. PG →
// pg_roles (password-masked). Read-only by design: this slice lists
// accounts/permissions only; CREATE/ALTER/DROP ROLE land in a later depth
// step (breadth-first). No secret column crosses the wire — the backend
// sources pg_roles, never pg_authid/pg_shadow.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listDatabaseUsers,
  type DatabaseUserRow,
} from "@/lib/api/databaseUsers";
import { DATABASE_TYPE_LABELS, paradigmOf, type DatabaseType } from "../model";
import { PanelLoadingSkeleton } from "./PanelLoadingSkeleton";

export interface DatabaseUsersPanelProps {
  connectionId: string;
  dbType: DatabaseType;
}

export function DatabaseUsersPanel({
  connectionId,
  dbType,
}: DatabaseUsersPanelProps) {
  const { t } = useTranslation("featuresConnection");
  const paradigm = paradigmOf(dbType);
  const [rows, setRows] = useState<DatabaseUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await listDatabaseUsers(connectionId);
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

  const yesNo = (v: boolean) =>
    v ? t("databaseUsers.yes") : t("databaseUsers.no");

  return (
    <section
      aria-label={t("databaseUsers.ariaSection")}
      data-paradigm={paradigm}
      data-testid="database-users-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          {t("databaseUsers.header", {
            paradigm: DATABASE_TYPE_LABELS[dbType],
          })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="database-users-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          {t("databaseUsers.refresh")}
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="database-users-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading && rows.length === 0 && <PanelLoadingSkeleton />}

      {!loading && error === null && rows.length === 0 && (
        <p
          role="status"
          data-testid="database-users-empty"
          className="px-3 py-2 text-xs italic text-muted-foreground"
        >
          {t("databaseUsers.empty")}
        </p>
      )}

      {rows.length > 0 && (
        <table
          aria-label={t("databaseUsers.ariaGrid")}
          data-testid="database-users-grid"
          className="w-full border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-border bg-secondary text-left text-muted-foreground">
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colName")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colCanLogin")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colSuperuser")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colCreateDb")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colCreateRole")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colConnLimit")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colValidUntil")}
              </th>
              <th className="px-3 py-1 font-medium">
                {t("databaseUsers.colMemberOf")}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.name}
                className="border-b border-border last:border-none"
              >
                <td className="px-3 py-1 font-mono">{r.name}</td>
                <td className="px-3 py-1">{yesNo(r.canLogin)}</td>
                <td className="px-3 py-1">{yesNo(r.isSuperuser)}</td>
                <td className="px-3 py-1">{yesNo(r.canCreateDb)}</td>
                <td className="px-3 py-1">{yesNo(r.canCreateRole)}</td>
                <td className="px-3 py-1 font-mono">
                  {r.connLimit < 0 ? t("databaseUsers.unlimited") : r.connLimit}
                </td>
                <td className="px-3 py-1">{r.validUntil ?? "—"}</td>
                <td
                  className="px-3 py-1 max-w-md truncate"
                  title={r.memberOf.join(", ")}
                >
                  {r.memberOf.length > 0 ? r.memberOf.join(", ") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
