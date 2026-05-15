// Sprint 327 (2026-05-15) — U3 scaffolding. Collection / table stats panel.
// Mongo `collStats` / `dbStats` runCommand wrappers pending; RDB
// `pg_stat_user_tables` query reuses execute_query (Sprint 334).

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface CollectionStatsPanelProps {
  connectionId: string;
  database: string;
  collection: string;
  paradigm: "table" | "document";
}

export function CollectionStatsPanel({
  connectionId,
  database,
  collection,
  paradigm,
}: CollectionStatsPanelProps) {
  return (
    <section
      aria-label="Collection stats"
      data-paradigm={paradigm}
      data-testid="collection-stats-panel"
    >
      <BackendPendingPlaceholder
        title={`Stats — ${database}.${collection}`}
        pendingSprint="Sprint 334"
        description={
          paradigm === "document"
            ? `Mongo collStats runCommand wrapper pending (conn ${connectionId}).`
            : `RDB pg_stat_user_tables / pg_class wiring pending (conn ${connectionId}).`
        }
        testId="collection-stats-placeholder"
      />
    </section>
  );
}
