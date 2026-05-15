// Sprint 327 (2026-05-15) — U5 scaffolding. Slow query / profiler panel.
// RDB `pg_stat_statements` reuses execute_query; Mongo `system.profile`
// find + profiler level toggle wrappers pending (Sprint 336).

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface SlowQueryPanelProps {
  connectionId: string;
  paradigm: "table" | "document";
}

export function SlowQueryPanel({
  connectionId,
  paradigm,
}: SlowQueryPanelProps) {
  return (
    <section
      aria-label="Slow queries"
      data-paradigm={paradigm}
      data-testid="slow-query-panel"
    >
      <BackendPendingPlaceholder
        title="Slow queries / Profiler"
        pendingSprint="Sprint 336"
        description={
          paradigm === "document"
            ? `Mongo system.profile + profiler level toggle pending (conn ${connectionId}).`
            : `RDB pg_stat_statements wiring pending (conn ${connectionId}).`
        }
        testId="slow-query-placeholder"
      />
    </section>
  );
}
