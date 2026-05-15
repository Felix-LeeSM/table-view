// Sprint 327 (2026-05-15) — Slice L scaffolding. Mongo collection DDL
// (create capped / timeseries, rename, drop). drop is already covered by
// `drop_collection` — create/rename wrappers land in Sprint 330.

import { BackendPendingPlaceholder } from "@/components/shared/BackendPendingPlaceholder";

export type CollectionDdlMode = "create" | "rename" | "drop";

export interface CollectionDdlDialogProps {
  open: boolean;
  mode: CollectionDdlMode;
  connectionId: string;
  database: string;
  collection?: string;
  onClose: () => void;
}

export function CollectionDdlDialog({
  open,
  mode,
  connectionId,
  database,
  collection,
  onClose,
}: CollectionDdlDialogProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label={`Collection DDL — ${mode}`}
      data-testid="collection-ddl-dialog"
    >
      <BackendPendingPlaceholder
        title={`Collection ${mode} — ${database}${collection ? "." + collection : ""}`}
        pendingSprint="Sprint 330"
        description={
          mode === "drop"
            ? `drop_collection wrapper already wired (conn ${connectionId}); dialog UX moves here in Sprint 330.`
            : `createCollection / renameCollection wrappers pending (conn ${connectionId}).`
        }
        testId="collection-ddl-placeholder"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close collection DDL dialog"
      >
        Close
      </button>
    </div>
  );
}
