// Sprint 211 — `DocumentQuickLookBody` is the document-paradigm body of
// QuickLook: namespace title (`Document Details — database.collection`
// with the multi-select suffix), and the dual-mode body (read-only BSON
// tree vs. edit-mode FieldRows over the synthesized columns).
//
// External invariants preserved verbatim:
// - Region `aria-label` = `"Document Details"`.
// - Close button `aria-label` = `"Close document details"`.
// - Multi-select suffix = `({n} selected, showing first)` when
//   `selectedRowIds.size > 1`.
// - Out-of-bounds / empty `rawDocuments` produces the BSON empty state
//   (`/No document selected/i`) without unmounting the panel.
// - In edit mode `_id` / PK / BLOB columns stay read-only via the shared
//   `isEditableColumn` gate (housed in `helpers.ts`); document mode has no
//   BLOB columns in V1, so `onBlobView` is a no-op.
// - Read-only-tree vs. edit-FieldRows toggle: FieldRows render iff
//   `editing && editState && data` are all present; otherwise the BSON
//   tree stays mounted.
import { useMemo } from "react";
import type { MouseEvent, KeyboardEvent } from "react";
import type { TableData } from "@/types/schema";
import BsonTreeViewer from "@components/shared/BsonTreeViewer";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import QuickLookShell from "./QuickLookShell";
import { FieldRow } from "./FieldRow";
import { selectedRowIsDirty } from "./helpers";

export interface DocumentQuickLookBodyProps {
  rawDocuments: Record<string, unknown>[];
  selectedRowIds: Set<number>;
  database: string;
  collection: string;
  onClose: () => void;
  firstSelectedId: number | null;
  height: number;
  onResizeMouseDown: (e: MouseEvent) => void;
  onResizeKeyDown: (e: KeyboardEvent) => void;
  editState?: DataGridEditState;
  data?: TableData;
  editing: boolean;
  onToggleEdit: () => void;
}

export default function DocumentQuickLookBody({
  rawDocuments,
  selectedRowIds,
  database,
  collection,
  onClose,
  firstSelectedId,
  height,
  onResizeMouseDown,
  onResizeKeyDown,
  editState,
  data,
  editing,
  onToggleEdit,
}: DocumentQuickLookBodyProps) {
  // Out-of-range or missing selection → pass `null` so BsonTreeViewer's
  // built-in empty state takes over. This keeps the panel mounted (so the
  // header stays useful) while still surfacing "No document selected".
  const documentValue = useMemo<Record<string, unknown> | null>(() => {
    if (
      firstSelectedId == null ||
      firstSelectedId < 0 ||
      firstSelectedId >= rawDocuments.length
    ) {
      return null;
    }
    return rawDocuments[firstSelectedId] ?? null;
  }, [firstSelectedId, rawDocuments]);

  const displayNamespace = `${database}.${collection}`;

  const isDirty = useMemo(
    () =>
      selectedRowIsDirty(firstSelectedId, editState?.pendingEdits ?? new Map()),
    [firstSelectedId, editState?.pendingEdits],
  );

  // In edit mode we render FieldRows over the synthesized columns — same
  // per-field flow as RDB. Falls back to the BSON tree when not editing or
  // when the call-site did not supply `data`.
  const showFieldRows = editing && !!editState && !!data;

  const editRow = useMemo(() => {
    if (!showFieldRows) return null;
    if (firstSelectedId == null || !data) return null;
    if (firstSelectedId < 0 || firstSelectedId >= data.rows.length) return null;
    return data.rows[firstSelectedId] as unknown[];
  }, [showFieldRows, firstSelectedId, data]);

  const title = (
    <>
      Document Details —{" "}
      <span className="font-mono text-muted-foreground">
        {displayNamespace}
      </span>
      {selectedRowIds.size > 1 && (
        <span className="ml-2 text-muted-foreground">
          ({selectedRowIds.size} selected, showing first)
        </span>
      )}
    </>
  );

  return (
    <QuickLookShell
      regionLabel="Document Details"
      height={height}
      onResizeMouseDown={onResizeMouseDown}
      onResizeKeyDown={onResizeKeyDown}
      // Preserve the pre-211 document-mode resize handle dark variant.
      resizeHandleClassName="dark:bg-muted/20"
      title={title}
      closeLabel="Close document details"
      isDirty={isDirty}
      editing={editing}
      onToggleEdit={onToggleEdit}
      onClose={onClose}
      editState={editState}
    >
      {showFieldRows && editRow && data ? (
        data.columns.map((col, idx) => (
          <FieldRow
            key={col.name}
            column={col}
            value={editRow[idx]}
            rowIdx={firstSelectedId ?? 0}
            colIdx={idx}
            onBlobView={() => {
              /* Document mode doesn't have BLOB columns in V1. */
            }}
            editing={editing}
            editState={editState}
          />
        ))
      ) : (
        <BsonTreeViewer value={documentValue} />
      )}
    </QuickLookShell>
  );
}
