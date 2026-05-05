// Sprint 211 — `RdbQuickLookBody` is the RDB-paradigm body of QuickLook:
// header title (`Row Details — schema.table` with the multi-select suffix),
// the per-column `FieldRow` list iterated over `data.columns`, and the
// `BlobViewerDialog` wiring (local `{data, columnName} | null` mirrored
// from the pre-211 god file). Returns `null` when the selected row index
// is out of bounds or selection is empty so the existing
// "renders nothing when out of bounds / empty" tests continue to pass.
//
// External invariants preserved verbatim:
// - Region `aria-label` = `"Row Details"`.
// - Close button `aria-label` = `"Close row details"`.
// - Multi-select suffix = `({n} selected, showing first)` when
//   `selectedRowIds.size > 1`.
// - Schema prefix shows iff `schema` is non-empty.
// - `BlobViewerDialog` mounts iff a BLOB cell was clicked; closing it via
//   `onOpenChange(false)` clears the local state.
import { useCallback, useMemo, useState } from "react";
import type { MouseEvent, KeyboardEvent } from "react";
import type { TableData } from "@/types/schema";
import BlobViewerDialog from "@components/datagrid/BlobViewerDialog";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import QuickLookShell from "./QuickLookShell";
import { FieldRow } from "./FieldRow";
import { selectedRowIsDirty } from "./helpers";

export interface RdbQuickLookBodyProps {
  data: TableData;
  selectedRowIds: Set<number>;
  schema: string;
  table: string;
  onClose: () => void;
  firstSelectedId: number | null;
  height: number;
  onResizeMouseDown: (e: MouseEvent) => void;
  onResizeKeyDown: (e: KeyboardEvent) => void;
  editState?: DataGridEditState;
  editing: boolean;
  onToggleEdit: () => void;
}

export default function RdbQuickLookBody({
  data,
  selectedRowIds,
  schema,
  table,
  onClose,
  firstSelectedId,
  height,
  onResizeMouseDown,
  onResizeKeyDown,
  editState,
  editing,
  onToggleEdit,
}: RdbQuickLookBodyProps) {
  const [blobViewer, setBlobViewer] = useState<{
    data: unknown;
    columnName: string;
  } | null>(null);

  const row = useMemo(() => {
    if (firstSelectedId == null || firstSelectedId >= data.rows.length) {
      return null;
    }
    return data.rows[firstSelectedId];
  }, [firstSelectedId, data.rows]);

  const handleBlobView = useCallback(
    (blobData: unknown, columnName: string) => {
      setBlobViewer({ data: blobData, columnName });
    },
    [],
  );

  const isDirty = useMemo(
    () =>
      selectedRowIsDirty(firstSelectedId, editState?.pendingEdits ?? new Map()),
    [firstSelectedId, editState?.pendingEdits],
  );

  if (!row) return null;

  const displayTable = schema ? `${schema}.${table}` : table;

  const title = (
    <>
      Row Details —{" "}
      <span className="font-mono text-muted-foreground">{displayTable}</span>
      {selectedRowIds.size > 1 && (
        <span className="ml-2 text-muted-foreground">
          ({selectedRowIds.size} selected, showing first)
        </span>
      )}
    </>
  );

  return (
    <QuickLookShell
      regionLabel="Row Details"
      height={height}
      onResizeMouseDown={onResizeMouseDown}
      onResizeKeyDown={onResizeKeyDown}
      title={title}
      closeLabel="Close row details"
      isDirty={isDirty}
      editing={editing}
      onToggleEdit={onToggleEdit}
      onClose={onClose}
      editState={editState}
    >
      {data.columns.map((col, idx) => {
        const cellValue = (row as unknown[])[idx];
        return (
          <FieldRow
            key={col.name}
            column={col}
            value={cellValue}
            rowIdx={firstSelectedId ?? 0}
            colIdx={idx}
            onBlobView={handleBlobView}
            editing={editing}
            editState={editState}
          />
        );
      })}
      {blobViewer && (
        <BlobViewerDialog
          open={blobViewer !== null}
          onOpenChange={(open) => {
            if (!open) setBlobViewer(null);
          }}
          data={blobViewer.data}
          columnName={blobViewer.columnName}
        />
      )}
    </QuickLookShell>
  );
}
