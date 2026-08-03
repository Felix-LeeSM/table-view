// RDB-paradigm body of QuickLook: header title
// (`Row Details — schema.table` with multi-select suffix), per-column
// `FieldRow` list, and `BlobViewerDialog` wiring. Returns `null` when the
// selected row index is out of bounds or selection is empty.
//
// External invariants:
// - Region `aria-label` = `"Row Details"`.
// - Close button `aria-label` = `"Close row details"`.
// - No Edit toggle (#1734 (4)): passing `editState` is what makes the fields
//   editable, so every editable column shows its editor as soon as the panel
//   opens. Read-only call-sites simply omit `editState`.
// - Multi-select suffix = `({n} selected, showing first)` when
//   `selectedRowIds.size > 1`.
// - Schema prefix shows iff `schema` is non-empty.
// - `BlobViewerDialog` mounts iff a BLOB cell was clicked; closing it via
//   `onOpenChange(false)` clears the local state.

import BlobViewerDialog from "@components/datagrid/BlobViewerDialog";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import type { KeyboardEvent, MouseEvent, RefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TableData } from "@/types/schema";
import { FieldRow } from "./FieldRow";
import { selectedRowIsDirty } from "./helpers";
import QuickLookShell from "./QuickLookShell";

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
  panelRef?: RefObject<HTMLDivElement | null>;
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
  panelRef,
}: RdbQuickLookBodyProps) {
  const { t } = useTranslation("shared");
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
      {t("rowDetails.heading")}{" "}
      <span className="font-mono text-muted-foreground">{displayTable}</span>
      {selectedRowIds.size > 1 && (
        <span className="ml-2 text-muted-foreground">
          {t("rowDetails.multiSelect", { count: selectedRowIds.size })}
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
      onClose={onClose}
      editState={editState}
      panelRef={panelRef}
    >
      {data.columns.map((col, idx) => {
        const cellValue = (row as unknown[])[idx];
        return (
          <FieldRow
            // Row index is part of the key so moving the selection remounts the
            // fields (same idiom as the grid's `row-${page}-${rowIdx}`).
            // `EditableValue` seeds a local draft from the cell on mount; with a
            // row-independent key the draft would survive the switch and show
            // the previous row's text over the new row's value. Always-on
            // editing (#1734 (4)) makes that visible on every selection move.
            key={`${firstSelectedId}-${col.name}`}
            column={col}
            value={cellValue}
            rowIdx={firstSelectedId ?? 0}
            colIdx={idx}
            onBlobView={handleBlobView}
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
