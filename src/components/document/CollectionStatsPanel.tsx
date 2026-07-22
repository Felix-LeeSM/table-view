// Sprint 338 (2026-05-15) — U3 live wire. Replaces the
// BackendPendingPlaceholder with a live stats grid sourced from
// `pg_stat_user_tables` (RDB) or `runCommand({collStats})` (Mongo).

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRefreshEvent } from "@/hooks/useRefreshEvent";
import { DataGridSkeleton } from "@components/datagrid";
import {
  collectionStatsMongo,
  collectionStatsRdb,
  type CollectionStatsRow,
} from "@/lib/api/collectionStats";
import { safeStringifyCell } from "@/lib/jsonCell";
import {
  DATABASE_TYPE_LABELS,
  paradigmOf,
  type DatabaseType,
} from "@/types/connection";

export interface CollectionStatsPanelProps {
  connectionId: string;
  database: string;
  collection: string;
  dbType: DatabaseType;
}

export function CollectionStatsPanel({
  connectionId,
  database,
  collection,
  dbType,
}: CollectionStatsPanelProps) {
  const { t } = useTranslation("document");
  const paradigm = paradigmOf(dbType);
  const [stats, setStats] = useState<CollectionStatsRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next =
        paradigm === "document"
          ? await collectionStatsMongo(connectionId, database, collection)
          : await collectionStatsRdb(connectionId, database, collection);
      setStats(next);
      setHasFetched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setHasFetched(true);
    } finally {
      setLoading(false);
    }
  }, [connectionId, paradigm, database, collection]);

  // #1718 (Part of #1717) — a soft refresh (Cmd+R) on the Mongo Structure pane
  // broadcasts `refresh-structure`; reload the stats for the visible panel.
  useRefreshEvent("refresh-structure", () => void refresh());

  return (
    <section
      aria-label={t("collectionStats.ariaLabel")}
      data-paradigm={paradigm}
      data-testid="collection-stats-panel"
      className="flex flex-col gap-2 p-3"
    >
      <header className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>
          Stats — {database}.{collection} ({DATABASE_TYPE_LABELS[dbType]})
        </span>
        <Button
          variant="ghost"
          size="sm"
          data-testid="collection-stats-refresh"
          onClick={() => void refresh()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="animate-spin" size={12} aria-hidden />
          ) : (
            <RefreshCw size={12} aria-hidden />
          )}
          {hasFetched
            ? t("collectionStats.refresh")
            : t("collectionStats.loadStats")}
        </Button>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="collection-stats-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {loading && stats === null && <DataGridSkeleton />}

      {!loading && error === null && stats !== null && (
        <dl
          data-testid="collection-stats-grid"
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs"
        >
          <dt className="text-muted-foreground">{t("collectionStats.rows")}</dt>
          <dd className="font-mono">{stats.rows.toLocaleString()}</dd>
          <dt className="text-muted-foreground">
            {t("collectionStats.sizeBytes")}
          </dt>
          <dd className="font-mono">{stats.sizeBytes.toLocaleString()}</dd>
          <dt className="text-muted-foreground">
            {t("collectionStats.indexes")}
          </dt>
          <dd className="font-mono">{stats.indexes}</dd>
          {stats.lastVacuum !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("collectionStats.lastVacuum")}
              </dt>
              <dd className="font-mono">{stats.lastVacuum}</dd>
            </>
          )}
          {stats.lastAnalyze !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("collectionStats.lastAnalyze")}
              </dt>
              <dd className="font-mono">{stats.lastAnalyze}</dd>
            </>
          )}
          {stats.seqScans !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("collectionStats.seqScans")}
              </dt>
              <dd className="font-mono">{stats.seqScans.toLocaleString()}</dd>
            </>
          )}
          {stats.idxScans !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("collectionStats.idxScans")}
              </dt>
              <dd className="font-mono">{stats.idxScans.toLocaleString()}</dd>
            </>
          )}
          {stats.nDead !== null && (
            <>
              <dt className="text-muted-foreground">
                {t("collectionStats.deadRows")}
              </dt>
              <dd className="font-mono">{stats.nDead.toLocaleString()}</dd>
            </>
          )}
          {Object.keys(stats.extras).length > 0 && (
            <>
              <dt className="col-span-2 mt-2 text-muted-foreground">
                {t("collectionStats.extras")}
              </dt>
              <dd className="col-span-2 max-h-48 overflow-auto rounded-md border border-border bg-secondary/30 p-2 font-mono text-xs">
                {safeStringifyCell(stats.extras, 2)}
              </dd>
            </>
          )}
        </dl>
      )}
    </section>
  );
}
