// Sprint 327 (2026-05-15) — Slice J scaffolding. Indexes panel surface for
// both RDB (get_table_indexes already exists; wire-up in Sprint 328) and
// Mongo (`list_indexes` + `$indexStats` backend pending). v0 renders a
// placeholder; Sprint 328 swaps it for the live grid.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface IndexesPanelProps {
  connectionId: string;
  database: string;
  collection: string;
  /** Sprint 328 will branch on this for RDB vs Mongo data source. */
  paradigm: "table" | "document";
}

export function IndexesPanel({
  connectionId,
  database,
  collection,
  paradigm,
}: IndexesPanelProps) {
  return (
    <section aria-label="Indexes panel" data-paradigm={paradigm}>
      <BackendPendingPlaceholder
        title={`Indexes — ${database}.${collection}`}
        pendingSprint="Sprint 328"
        description={
          paradigm === "document"
            ? `Mongo list_indexes + $indexStats wrapper deferred (conn ${connectionId}).`
            : `RDB get_table_indexes wire-up deferred (conn ${connectionId}).`
        }
        testId="indexes-panel-placeholder"
      />
    </section>
  );
}
