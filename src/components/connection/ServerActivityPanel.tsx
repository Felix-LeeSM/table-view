// Sprint 327 (2026-05-15) — U1 scaffolding. Server activity (Postgres
// pg_stat_activity / Mongo db.currentOp) + Kill action. RDB path can reuse
// execute_query directly; Mongo `currentOp`/`killOp` wrappers pending in
// Sprint 332.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface ServerActivityPanelProps {
  connectionId: string;
  paradigm: "table" | "document";
}

export function ServerActivityPanel({
  connectionId,
  paradigm,
}: ServerActivityPanelProps) {
  return (
    <section
      aria-label="Server activity"
      data-paradigm={paradigm}
      data-testid="server-activity-panel"
    >
      <BackendPendingPlaceholder
        title="Server activity"
        pendingSprint="Sprint 332"
        description={
          paradigm === "document"
            ? `Mongo currentOp + killOp IPC pending (conn ${connectionId}).`
            : `RDB pg_stat_activity wiring via execute_query pending (conn ${connectionId}).`
        }
        testId="server-activity-placeholder"
      />
    </section>
  );
}
