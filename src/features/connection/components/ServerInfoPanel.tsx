// Sprint 339 (2026-05-15) — U4 live wire. Replaces the
// BackendPendingPlaceholder with a paradigm-neutral identity grid sourced
// from `version()` + `pg_settings` (PG) or `buildInfo` + `serverStatus`
// (Mongo). All paradigm-specific fields land in `extras` so the grid stays
// paradigm-stable.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { serverInfo, type ServerInfoRow } from "@/lib/api/serverInfo";
import { safeStringifyCell } from "@/lib/jsonCell";
import { DATABASE_TYPE_LABELS, paradigmOf, type DatabaseType } from "../model";
import { PanelLoadingSkeleton } from "./PanelLoadingSkeleton";

export interface ServerInfoPanelProps {
  connectionId: string;
  dbType: DatabaseType;
}

export function ServerInfoPanel({
  connectionId,
  dbType,
}: ServerInfoPanelProps) {
  const { t } = useTranslation("featuresConnection");
  const paradigm = paradigmOf(dbType);
  const [info, setInfo] = useState<ServerInfoRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await serverInfo(connectionId);
      setInfo(next);
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
      aria-label={t("serverInfo.ariaSection")}
      data-paradigm={paradigm}
      data-testid="server-info-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          {t("serverInfo.header", { paradigm: DATABASE_TYPE_LABELS[dbType] })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="server-info-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          {t("serverInfo.refresh")}
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="server-info-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading && info === null && <PanelLoadingSkeleton />}

      {!loading && error === null && info !== null && (
        <dl
          data-testid="server-info-grid"
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        >
          <dt className="text-muted-foreground">
            {t("serverInfo.rowVersion")}
          </dt>
          <dd className="font-mono break-all">{info.version}</dd>
          {info.host !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowHost")}
              </dt>
              <dd className="font-mono">{info.host}</dd>
            </>
          )}
          {info.uptimeSec !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowUptime")}
              </dt>
              <dd className="font-mono">{info.uptimeSec.toLocaleString()}</dd>
            </>
          )}
          {info.connectionsActive !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("serverInfo.rowConnections")}
              </dt>
              <dd className="font-mono">
                {info.connectionsActive.toLocaleString()}
              </dd>
            </>
          )}
          {Object.keys(info.extras).length > 0 && (
            <>
              <dt className="col-span-2 mt-2 text-muted-foreground">
                {t("serverInfo.rowExtras")}
              </dt>
              <dd className="col-span-2 max-h-48 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs">
                {safeStringifyCell(info.extras, 2)}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
