// Sprint 327 (2026-05-15) — Slice M scaffolding. Database create / drop
// dialog. Both RDB (`CREATE DATABASE` / `DROP DATABASE`) and Mongo
// (`createCollection` on a new db / `dropDatabase`) wrappers pending in
// Sprint 331.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export type DbLifecycleMode = "create" | "drop";

export interface DbLifecycleDialogProps {
  open: boolean;
  mode: DbLifecycleMode;
  connectionId: string;
  database?: string;
  paradigm: "table" | "document";
  onClose: () => void;
}

export function DbLifecycleDialog({
  open,
  mode,
  connectionId,
  database,
  paradigm,
  onClose,
}: DbLifecycleDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Database ${mode}`}
      data-testid="db-lifecycle-dialog"
      data-paradigm={paradigm}
    >
      <BackendPendingPlaceholder
        title={`Database ${mode}${database ? ` — ${database}` : ""}`}
        pendingSprint="Sprint 331"
        description={
          paradigm === "document"
            ? `Mongo create/drop database wrappers pending (conn ${connectionId}).`
            : `RDB CREATE/DROP DATABASE wrappers pending (conn ${connectionId}). v0 will go through execute_query.`
        }
        testId="db-lifecycle-placeholder"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close database lifecycle dialog"
      >
        Close
      </button>
    </div>
  );
}
