// Sprint 211 — `QuickLookPanel` entry. The pre-211 868-line god file owned
// seven concerns (RDB body + document body + per-cell formatting + per-cell
// edit rendering + resize shell + dirty-pill + close/edit/resize header
// chrome). Sprint 211 split that into:
//
//   * this thin entry — owns cross-paradigm state (panel `height`,
//     `editing` toggle, the `firstSelectedId` derivation), builds the
//     shared resize handlers, and dispatches on the `mode` discriminator;
//   * `./QuickLookPanel/QuickLookShell` — presentational chrome
//     (region wrapper, resize handle, header bar, body slot);
//   * `./QuickLookPanel/RdbQuickLookBody` — RDB body (column FieldRow list
//     + BLOB viewer wiring + out-of-bounds null return);
//   * `./QuickLookPanel/DocumentQuickLookBody` — document body
//     (read-only BSON tree + edit FieldRows + multi-select suffix);
//   * `./QuickLookPanel/helpers` — pure helpers + per-cell renderers
//     (`FieldRow`, `EditableValue`) + the four resize constants.
//
// External invariants preserved verbatim:
// - Default export is the React component, importable from
//   the same `@components/shared/QuickLookPanel` barrel as before.
// - Three named props types (`QuickLookPanelProps`,
//   `QuickLookPanelRdbProps`, `QuickLookPanelDocumentProps`) remain
//   exported from this entry file.
// - Both importers (`src/components/rdb/DataGrid.tsx`,
//   `src/components/document/DocumentDataGrid.tsx`) keep their import
//   paths byte-for-byte unchanged.
// - The 980-line `QuickLookPanel.test.tsx` regression guard is not
//   modified; every assertion it makes continues to pass.
import { useState, useCallback, useMemo } from "react";
import type { TableData } from "@/types/schema";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import RdbQuickLookBody from "./QuickLookPanel/RdbQuickLookBody";
import DocumentQuickLookBody from "./QuickLookPanel/DocumentQuickLookBody";
import {
  DEFAULT_HEIGHT,
  KEYBOARD_RESIZE_STEP,
  clampHeight,
} from "./QuickLookPanel/helpers";

// ── QuickLookPanel Props ──────────────────────────────────────────────

/**
 * Props discriminated union — `mode` selects between the classic RDB
 * column-oriented renderer (default, backwards compatible) and the
 * document-paradigm BSON tree renderer. The default "rdb" mode keeps the
 * existing call-sites in `DataGrid.tsx` working without any changes; a
 * paradigm-aware call-site opts in with `mode: "document"` and supplies
 * `rawDocuments` plus `database`/`collection` labels.
 *
 * Sprint 194 — Optional `editState` enables in-panel editing. When present,
 * the header surfaces an Edit toggle and per-column cells become editable
 * (RDB) or the BSON tree swaps to per-field FieldRows (document). When
 * absent the panel stays fully read-only — existing read-only call-sites
 * are unaffected.
 */
export interface QuickLookPanelRdbProps {
  mode?: "rdb";
  data: TableData;
  selectedRowIds: Set<number>;
  schema: string;
  table: string;
  onClose: () => void;
  editState?: DataGridEditState;
}

export interface QuickLookPanelDocumentProps {
  mode: "document";
  rawDocuments: Record<string, unknown>[];
  selectedRowIds: Set<number>;
  database: string;
  collection: string;
  onClose: () => void;
  /**
   * Sprint 194 — Required when `editState` is provided so document edit mode
   * can render FieldRows over the synthesized columns. The existing read-only
   * call-site can omit it.
   */
  data?: TableData;
  editState?: DataGridEditState;
}

export type QuickLookPanelProps =
  | QuickLookPanelRdbProps
  | QuickLookPanelDocumentProps;

export default function QuickLookPanel(props: QuickLookPanelProps) {
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [editing, setEditing] = useState(false);

  // Shared selection arithmetic — both paradigms use the smallest-index
  // row as the "first" selected, matching the existing RDB behaviour.
  const firstSelectedId = useMemo(() => {
    if (props.selectedRowIds.size === 0) return null;
    return Math.min(...props.selectedRowIds);
  }, [props.selectedRowIds]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startHeight = height;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const delta = startY - moveEvent.clientY; // dragging up = increase height
        const newHeight = clampHeight(startHeight + delta);
        setHeight(newHeight);
      };

      const handleMouseUp = () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [height],
  );

  // Keyboard resize: Shift+ArrowUp/Down adjusts the panel height in
  // KEYBOARD_RESIZE_STEP (8px) increments, clamped to [MIN_HEIGHT, MAX_HEIGHT].
  // Dragging up = bigger panel, so ArrowUp grows and ArrowDown shrinks.
  // Plain arrow keys (no Shift) are intentionally ignored so they remain
  // available for caret/scroll behaviour elsewhere.
  const handleResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!e.shiftKey) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHeight((h) => clampHeight(h + KEYBOARD_RESIZE_STEP));
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHeight((h) => clampHeight(h - KEYBOARD_RESIZE_STEP));
    }
  }, []);

  if (props.mode === "document") {
    return (
      <DocumentQuickLookBody
        rawDocuments={props.rawDocuments}
        selectedRowIds={props.selectedRowIds}
        database={props.database}
        collection={props.collection}
        onClose={props.onClose}
        firstSelectedId={firstSelectedId}
        height={height}
        onResizeMouseDown={handleMouseDown}
        onResizeKeyDown={handleResizeKeyDown}
        editState={props.editState}
        data={props.data}
        editing={editing}
        onToggleEdit={() => setEditing((v) => !v)}
      />
    );
  }

  return (
    <RdbQuickLookBody
      data={props.data}
      selectedRowIds={props.selectedRowIds}
      schema={props.schema}
      table={props.table}
      onClose={props.onClose}
      firstSelectedId={firstSelectedId}
      height={height}
      onResizeMouseDown={handleMouseDown}
      onResizeKeyDown={handleResizeKeyDown}
      editState={props.editState}
      editing={editing}
      onToggleEdit={() => setEditing((v) => !v)}
    />
  );
}
