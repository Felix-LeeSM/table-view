// Sprint 332 (2026-05-15) — Slice J live wire. Mongo paradigm 의 indexes
// 가 `list_mongo_indexes` IPC 를 호출해 실제 데이터를 fetch + 렌더한다.
// RDB paradigm 은 `getTableIndexes` 가 schema/table 인자를 요구하는데 본
// 컴포넌트는 (database, collection) 만 받으므로 v0 에서는 placeholder 를
// 유지 — RDB live wire 는 별도 sprint 에서 schema 인자가 명확히 흐를
// 때 진행. Sprint 327 placeholder 가 그 위치를 점유한다.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";
import { listMongoIndexes } from "@/lib/tauri";
import type { IndexInfo } from "@/types/schema";
import { paradigmOf, type DatabaseType } from "@/types/connection";

export interface IndexesPanelProps {
  connectionId: string;
  database: string;
  collection: string;
  dbType: DatabaseType;
}

export function IndexesPanel({
  connectionId,
  database,
  collection,
  dbType,
}: IndexesPanelProps) {
  const { t } = useTranslation("schema");
  const paradigm = paradigmOf(dbType);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (paradigm !== "document") return;
    if (database === "" || collection === "") return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    listMongoIndexes(connectionId, database, collection)
      .then((rows) => {
        if (cancelled) return;
        setIndexes(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, database, collection, paradigm]);

  if (paradigm !== "document") {
    return (
      <section aria-label="Indexes panel" data-paradigm={paradigm}>
        <BackendPendingPlaceholder
          title={`Indexes — ${database}.${collection}`}
          pendingSprint="후속 sprint"
          description={`RDB get_table_indexes wire-up 은 schema 인자 흐름이 정리된 뒤 별도 sprint 에서 진행 (conn ${connectionId}).`}
          testId="indexes-panel-placeholder"
        />
      </section>
    );
  }

  return (
    <section
      aria-label="Indexes panel"
      data-paradigm={paradigm}
      className="flex flex-col gap-2"
    >
      <header className="flex items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
        <span>{t("indexesHeader", { db: database, collection })}</span>
        {loading && (
          <span className="flex items-center gap-1 text-3xs">
            <Loader2 className="animate-spin" size={10} aria-hidden />
            {t("loadingEllipsis")}
          </span>
        )}
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="indexes-panel-error"
          className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </div>
      )}

      {!loading && error === null && indexes.length === 0 && (
        <div
          role="status"
          data-testid="indexes-panel-empty"
          className="px-3 py-2 text-xs italic text-muted-foreground"
        >
          {t("noIndexesOnCollection")}
        </div>
      )}

      {indexes.length > 0 && (
        <table
          aria-label={t("collectionIndexesAria")}
          data-testid="indexes-panel-table"
          className="w-full border-collapse text-xs"
        >
          <thead>
            <tr className="border-b border-border bg-secondary text-left text-muted-foreground">
              <th className="px-3 py-1 font-medium">{t("colNameIndex")}</th>
              <th className="px-3 py-1 font-medium">{t("colFields")}</th>
              <th className="px-3 py-1 font-medium">{t("colIndexType")}</th>
              <th className="px-3 py-1 font-medium">{t("colUnique")}</th>
            </tr>
          </thead>
          <tbody>
            {indexes.map((idx) => (
              <tr
                key={idx.name}
                className="border-b border-border last:border-none"
              >
                <td className="px-3 py-1">
                  <span className="font-mono">{idx.name}</span>
                  {idx.is_primary && (
                    <span className="ml-2 rounded bg-primary/10 px-1 text-3xs uppercase tracking-wider text-primary">
                      {t("primaryBadge")}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1 font-mono">
                  {idx.columns.join(", ")}
                </td>
                <td className="px-3 py-1">{idx.index_type}</td>
                <td className="px-3 py-1">
                  {idx.is_unique ? t("uniqueYes") : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
