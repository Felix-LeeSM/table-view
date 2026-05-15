// Sprint 327 (2026-05-15) — U2 scaffolding. Explain viewer for RDB
// (`EXPLAIN ANALYZE` via execute_query) and Mongo (`.explain()` cursor
// option, wrapper pending). Sprint 333 will land the live tree view.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface ExplainViewerProps {
  connectionId: string;
  paradigm: "table" | "document";
  /** v1 will accept the query text or pipeline; v0 placeholder ignores it. */
  query?: string;
}

export function ExplainViewer({
  connectionId,
  paradigm,
  query,
}: ExplainViewerProps) {
  return (
    <section
      aria-label="Explain viewer"
      data-paradigm={paradigm}
      data-testid="explain-viewer"
    >
      <BackendPendingPlaceholder
        title="Explain viewer"
        pendingSprint="Sprint 333"
        description={
          paradigm === "document"
            ? `Mongo cursor.explain() wrapper pending (conn ${connectionId}). Query preview: ${query ?? "—"}`
            : `RDB EXPLAIN ANALYZE wiring via execute_query pending (conn ${connectionId}). Query preview: ${query ?? "—"}`
        }
        testId="explain-viewer-placeholder"
      />
    </section>
  );
}
