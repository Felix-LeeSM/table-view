// Sprint 327 (2026-05-15) — Slice K scaffolding. Validator slot for Mongo
// collections (`$jsonSchema` via `collMod`). v0 placeholder; Sprint 329
// wires the editor + `collMod` IPC.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export interface ValidatorPanelProps {
  connectionId: string;
  database: string;
  collection: string;
}

export function ValidatorPanel({
  connectionId,
  database,
  collection,
}: ValidatorPanelProps) {
  return (
    <section aria-label="Validator panel">
      <BackendPendingPlaceholder
        title={`Validator — ${database}.${collection}`}
        pendingSprint="Sprint 329"
        description={`collMod {validator: $jsonSchema} wrapper deferred (conn ${connectionId}). RDB Views surfacing reuses list_views (already wired).`}
        testId="validator-panel-placeholder"
      />
    </section>
  );
}
