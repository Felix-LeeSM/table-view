import { useState, useCallback, useMemo } from "react";
import { X, Binary, GripHorizontal, Pencil, PencilOff } from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@lib/utils";
import type { ColumnInfo, TableData } from "@/types/schema";
import BlobViewerDialog from "@components/datagrid/BlobViewerDialog";
import BsonTreeViewer from "@components/shared/BsonTreeViewer";
import {
  cellToEditValue,
  editKey,
  getInputTypeForColumn,
  type DataGridEditState,
} from "@components/datagrid/useDataGridEdit";

// ── Helpers ───────────────────────────────────────────────────────────

function isBlobColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return (
    lower.includes("blob") ||
    lower.includes("bytea") ||
    lower.includes("binary") ||
    lower.includes("varbinary") ||
    lower.includes("image")
  );
}

function isJsonColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return lower.includes("json");
}

function isBoolColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return lower === "bool" || lower.includes("boolean");
}

/** Try to detect JSON-like string values. */
function looksLikeJson(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

function formatCellValue(value: unknown, col: ColumnInfo): string {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  // String values that look like JSON
  if (isJsonColumn(col.data_type) || looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value as string);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// Sprint 194 — column is editable in QuickLook iff (a) editState available,
// (b) not a primary key, (c) not a BLOB family. Generated/computed columns
// fall through the same gate via the underlying hook's commit path.
function isEditableColumn(col: ColumnInfo): boolean {
  if (col.is_primary_key) return false;
  if (isBlobColumn(col.data_type)) return false;
  return true;
}

// ── Field Row ─────────────────────────────────────────────────────────

interface FieldRowProps {
  column: ColumnInfo;
  value: unknown;
  rowIdx: number;
  colIdx: number;
  onBlobView: (data: unknown, columnName: string) => void;
  editing: boolean;
  editState?: DataGridEditState;
}

function FieldRow({
  column,
  value,
  rowIdx,
  colIdx,
  onBlobView,
  editing,
  editState,
}: FieldRowProps) {
  const isNull = value == null;
  const isBool = typeof value === "boolean";
  const isBlob = isBlobColumn(column.data_type) && value != null;
  const isObject = typeof value === "object" && value != null;
  const isJsonString =
    !isObject && isJsonColumn(column.data_type) && looksLikeJson(value);
  const isLargeText =
    typeof value === "string" && (value as string).length > 200;

  const displayValue = useMemo(
    () => formatCellValue(value, column),
    [value, column],
  );

  const editable = editing && !!editState && isEditableColumn(column);

  return (
    <div className="flex border-b border-border last:border-b-0">
      {/* Column name + type stacked vertically so a long type cannot
          truncate the column name (sprint-90 #QL-2). */}
      <div
        className="flex w-44 shrink-0 flex-col border-r border-border bg-muted/30 px-3 py-2 font-medium text-muted-foreground"
        title={column.data_type}
      >
        <span className="font-mono text-xs whitespace-normal break-words">
          {column.name}
        </span>
        <span className="text-3xs opacity-60 whitespace-normal break-words">
          {column.data_type}
        </span>
      </div>

      {/* Value */}
      <div className="flex-1 overflow-hidden px-3 py-2 text-xs">
        {editable ? (
          <EditableValue
            column={column}
            value={value}
            rowIdx={rowIdx}
            colIdx={colIdx}
            editState={editState}
            isJsonString={isJsonString}
            isObject={isObject}
            isLargeText={isLargeText}
          />
        ) : isNull ? (
          <span className="italic text-muted-foreground">NULL</span>
        ) : isBool ? (
          <span
            className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-3xs font-semibold",
              value
                ? "bg-success/15 text-success"
                : "bg-destructive/15 text-destructive",
            )}
          >
            {value ? "true" : "false"}
          </span>
        ) : isBlob ? (
          <Button
            variant="ghost"
            size="xs"
            className="bg-muted hover:bg-secondary text-muted-foreground"
            onClick={() => onBlobView(value, column.name)}
            aria-label={`View BLOB data for ${column.name}`}
          >
            <Binary />
            <span>(BLOB)</span>
          </Button>
        ) : isObject || isJsonString ? (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-foreground">
            {displayValue}
          </pre>
        ) : isLargeText ? (
          <textarea
            className="max-h-48 w-full resize-y bg-transparent font-mono text-foreground outline-none"
            value={String(value)}
            rows={3}
            readOnly
            aria-label={`Value for ${column.name}`}
          />
        ) : (
          <span className="font-mono text-foreground">{displayValue}</span>
        )}

        {/* Read-only marker for PK / BLOB so the user understands the input
            is intentionally absent in edit mode. Stays out of the DOM in
            read-only call-sites. */}
        {editing && !!editState && !isEditableColumn(column) && (
          <span
            className="ml-2 text-3xs italic text-muted-foreground"
            aria-disabled
          >
            (read-only)
          </span>
        )}
      </div>
    </div>
  );
}

// ── Editable value (Sprint 194) ──────────────────────────────────────

interface EditableValueProps {
  column: ColumnInfo;
  value: unknown;
  rowIdx: number;
  colIdx: number;
  editState: DataGridEditState;
  isJsonString: boolean;
  isObject: boolean;
  isLargeText: boolean;
}

function EditableValue({
  column,
  value,
  rowIdx,
  colIdx,
  editState,
  isJsonString,
  isObject,
  isLargeText,
}: EditableValueProps) {
  // Pending edit (if any) wins over the raw cell — so re-entering edit mode
  // shows the user's queued value, not the original.
  const key = editKey(rowIdx, colIdx);
  const pendingValue = editState.pendingEdits.has(key)
    ? (editState.pendingEdits.get(key) ?? null)
    : null;

  const initialString = useMemo(() => {
    if (pendingValue !== null) return pendingValue;
    return cellToEditValue(value) ?? "";
  }, [pendingValue, value]);

  const [draft, setDraft] = useState<string>(initialString);

  const dispatchSave = useCallback(
    (next: string | null) => {
      const original = cellToEditValue(value);
      editState.handleStartEdit(rowIdx, colIdx, original);
      editState.setEditValue(next);
      editState.saveCurrentEdit();
    },
    [editState, rowIdx, colIdx, value],
  );

  const dispatchSetNull = useCallback(() => {
    setDraft("");
    dispatchSave(null);
  }, [dispatchSave]);

  const useTextarea =
    isObject || isJsonString || isLargeText || isJsonColumn(column.data_type);
  const isBoolean = isBoolColumn(column.data_type);

  // Boolean — three-way select (true / false / NULL).
  if (isBoolean) {
    const current =
      pendingValue === null && value == null
        ? "NULL"
        : pendingValue !== null
          ? pendingValue
          : value === true
            ? "true"
            : value === false
              ? "false"
              : "NULL";
    return (
      <Select
        value={current}
        onValueChange={(v) => {
          if (v === "NULL") dispatchSave(null);
          else dispatchSave(v);
        }}
      >
        <SelectTrigger
          className="h-auto min-h-0 rounded border border-border bg-background px-1 py-0.5 font-mono text-xs text-foreground shadow-none"
          aria-label={`Edit value for ${column.name}`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true" className="font-mono text-xs">
            true
          </SelectItem>
          <SelectItem value="false" className="font-mono text-xs">
            false
          </SelectItem>
          <SelectItem value="NULL" className="font-mono text-xs">
            NULL
          </SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (useTextarea) {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          className="max-h-48 w-full resize-y rounded border border-border bg-background px-1 py-0.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
          value={draft}
          rows={4}
          aria-label={`Edit value for ${column.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setDraft(initialString);
              return;
            }
            // Cmd/Ctrl+Enter saves; plain Enter inserts newline.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              dispatchSave(draft);
            }
          }}
          onBlur={() => {
            if (draft !== initialString) dispatchSave(draft);
          }}
        />
        <div className="flex gap-1">
          <button
            type="button"
            className="text-3xs text-muted-foreground hover:text-foreground hover:underline"
            aria-label={`Set NULL for ${column.name}`}
            onClick={dispatchSetNull}
          >
            Set NULL
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type={getInputTypeForColumn(column.data_type)}
        className="flex-1 rounded border border-border bg-background px-1 py-0.5 font-mono text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
        value={draft}
        aria-label={`Edit value for ${column.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setDraft(initialString);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            dispatchSave(draft);
          }
        }}
        onBlur={() => {
          if (draft !== initialString) dispatchSave(draft);
        }}
      />
      <button
        type="button"
        className="text-3xs text-muted-foreground hover:text-foreground hover:underline"
        aria-label={`Set NULL for ${column.name}`}
        onClick={dispatchSetNull}
      >
        Set NULL
      </button>
    </div>
  );
}

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

const MIN_HEIGHT = 120;
const MAX_HEIGHT = 600;
const DEFAULT_HEIGHT = 280;
const KEYBOARD_RESIZE_STEP = 8;

function clampHeight(value: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value));
}

// Sprint 194 — does the selected row have any pending change? Pending edits
// carry the row idx as a `${rowIdx}-${colIdx}` prefix; pendingDeletedRowKeys
// uses a page-aware row key the panel does not have, so we only check the
// edit map for V1. New-row inserts are addressed via separate dedicated UI.
function selectedRowIsDirty(
  selectedRowIdx: number | null,
  pendingEdits: Map<string, string | null>,
): boolean {
  if (selectedRowIdx == null) return false;
  const prefix = `${selectedRowIdx}-`;
  for (const key of pendingEdits.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

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
      <DocumentModeBody
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
    <RdbModeBody
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

// ── Header chrome (Sprint 194) ───────────────────────────────────────

interface HeaderControlsProps {
  editState?: DataGridEditState;
  editing: boolean;
  onToggleEdit: () => void;
  isDirty: boolean;
  onClose: () => void;
  closeLabel: string;
}

function HeaderControls({
  editState,
  editing,
  onToggleEdit,
  isDirty,
  onClose,
  closeLabel,
}: HeaderControlsProps) {
  return (
    <div className="flex items-center gap-1">
      {isDirty && (
        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-3xs font-semibold text-warning">
          ● Modified
        </span>
      )}
      {editState && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Toggle edit mode"
          aria-pressed={editing}
          title={editing ? "Exit edit mode" : "Enter edit mode"}
          onClick={onToggleEdit}
        >
          {editing ? <PencilOff /> : <Pencil />}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onClose}
        aria-label={closeLabel}
      >
        <X />
      </Button>
    </div>
  );
}

// ── RDB mode body ─────────────────────────────────────────────────────

interface RdbBodyProps {
  data: TableData;
  selectedRowIds: Set<number>;
  schema: string;
  table: string;
  onClose: () => void;
  firstSelectedId: number | null;
  height: number;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onResizeKeyDown: (e: React.KeyboardEvent) => void;
  editState?: DataGridEditState;
  editing: boolean;
  onToggleEdit: () => void;
}

function RdbModeBody({
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
}: RdbBodyProps) {
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

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
      role="region"
      aria-label="Row Details"
    >
      {/* Resize handle */}
      <div
        className="flex h-2 cursor-row-resize items-center justify-center border-b border-border bg-muted/30 hover:bg-muted focus-visible:outline-1 focus-visible:outline-ring"
        onMouseDown={onResizeMouseDown}
        onKeyDown={onResizeKeyDown}
        tabIndex={0}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Quick Look panel"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          Row Details —{" "}
          <span className="font-mono text-muted-foreground">
            {displayTable}
          </span>
          {selectedRowIds.size > 1 && (
            <span className="ml-2 text-muted-foreground">
              ({selectedRowIds.size} selected, showing first)
            </span>
          )}
        </h3>
        <HeaderControls
          editState={editState}
          editing={editing}
          onToggleEdit={onToggleEdit}
          isDirty={isDirty}
          onClose={onClose}
          closeLabel="Close row details"
        />
      </div>

      {/* Scrollable field list */}
      <div className="flex-1 overflow-auto">
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
      </div>

      {/* BLOB viewer dialog */}
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
    </div>
  );
}

// ── Document mode body ────────────────────────────────────────────────

interface DocumentBodyProps {
  rawDocuments: Record<string, unknown>[];
  selectedRowIds: Set<number>;
  database: string;
  collection: string;
  onClose: () => void;
  firstSelectedId: number | null;
  height: number;
  onResizeMouseDown: (e: React.MouseEvent) => void;
  onResizeKeyDown: (e: React.KeyboardEvent) => void;
  editState?: DataGridEditState;
  data?: TableData;
  editing: boolean;
  onToggleEdit: () => void;
}

function DocumentModeBody({
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
}: DocumentBodyProps) {
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

  return (
    <div
      className="flex shrink-0 flex-col border-t border-border bg-background"
      style={{ height }}
      role="region"
      aria-label="Document Details"
    >
      {/* Resize handle */}
      <div
        className="flex h-2 cursor-row-resize items-center justify-center border-b border-border bg-muted/30 hover:bg-muted focus-visible:outline-1 focus-visible:outline-ring dark:bg-muted/20"
        onMouseDown={onResizeMouseDown}
        onKeyDown={onResizeKeyDown}
        tabIndex={0}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize Quick Look panel"
        aria-valuemin={MIN_HEIGHT}
        aria-valuemax={MAX_HEIGHT}
        aria-valuenow={height}
      >
        <GripHorizontal className="h-3 w-3 text-muted-foreground" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <h3 className="text-xs font-semibold text-foreground">
          Document Details —{" "}
          <span className="font-mono text-muted-foreground">
            {displayNamespace}
          </span>
          {selectedRowIds.size > 1 && (
            <span className="ml-2 text-muted-foreground">
              ({selectedRowIds.size} selected, showing first)
            </span>
          )}
        </h3>
        <HeaderControls
          editState={editState}
          editing={editing}
          onToggleEdit={onToggleEdit}
          isDirty={isDirty}
          onClose={onClose}
          closeLabel="Close document details"
        />
      </div>

      {/* Body — FieldRows in edit mode, BSON tree otherwise */}
      <div className="flex-1 overflow-auto">
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
      </div>
    </div>
  );
}
