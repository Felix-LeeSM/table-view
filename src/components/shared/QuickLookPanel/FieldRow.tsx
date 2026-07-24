// `FieldRow` + `EditableValue`: per-cell renderers shared by QuickLook's
// RDB and document bodies. Lives in a `.tsx` sibling to `helpers.ts`
// because JSX cannot be parsed inside a `.ts` file under
// `@vitejs/plugin-react`.
//
// Behavior contract:
// - Read-only path renders one of: NULL pill / boolean badge / BLOB button
//   / `<pre>` (object/json-string) / read-only `<textarea>` (large text)
//   / `<span>` (plain).
// - Edit path swaps in: 3-way `<Select>` (boolean) / `<textarea>` (jsonb /
//   object / json-string / large text) / `<input>` (everything else).
// - Esc reverts the local draft string without dispatching.
// - Plain `Enter` saves on input; on textarea plain `Enter` is a newline
//   and `Cmd/Ctrl+Enter` saves.
// - `Set NULL` dispatches `handleStartEdit → setEditValue(null) →
//   saveCurrentEdit` and clears the local draft to "".
// - PK / BLOB / `_id` cells emit a `(read-only)` marker when editing.
import { useCallback, useMemo, useState } from "react";
import { Binary } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@lib/utils";
import { INLINE_EDIT_INPUT } from "@components/ui/inlineEdit";
import type { ColumnInfo } from "@/types/schema";
import {
  cellToEditValue,
  editKey,
  getInputTypeForColumn,
} from "@components/datagrid/dataGridEditFsm";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import {
  formatCellValue,
  isBlobColumn,
  isBoolColumn,
  isEditableColumn,
  isJsonColumn,
  looksLikeJson,
} from "./helpers";

interface FieldRowProps {
  column: ColumnInfo;
  value: unknown;
  rowIdx: number;
  colIdx: number;
  onBlobView: (data: unknown, columnName: string) => void;
  editing: boolean;
  editState?: DataGridEditState;
}

export function FieldRow({
  column,
  value,
  rowIdx,
  colIdx,
  onBlobView,
  editing,
  editState,
}: FieldRowProps) {
  const { t } = useTranslation("shared");
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
            aria-label={t("fieldRow.viewBlob", { column: column.name })}
          >
            <Binary />
            <span>{t("fieldRow.blob")}</span>
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
            aria-label={t("fieldRow.valueFor", { column: column.name })}
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
            {t("fieldRow.readOnly")}
          </span>
        )}
      </div>
    </div>
  );
}

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

export function EditableValue({
  column,
  value,
  rowIdx,
  colIdx,
  editState,
  isJsonString,
  isObject,
  isLargeText,
}: EditableValueProps) {
  const { t } = useTranslation("shared");
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
          aria-label={t("fieldRow.editValueFor", { column: column.name })}
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
          className={cn("max-h-48 resize-y font-mono", INLINE_EDIT_INPUT)}
          value={draft}
          rows={4}
          aria-label={t("fieldRow.editValueFor", { column: column.name })}
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
            aria-label={t("fieldRow.setNullFor", { column: column.name })}
            onClick={dispatchSetNull}
          >
            {t("fieldRow.setNull")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type={getInputTypeForColumn(column.data_type)}
        className={cn("flex-1 font-mono", INLINE_EDIT_INPUT)}
        value={draft}
        aria-label={t("fieldRow.editValueFor", { column: column.name })}
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
        aria-label={t("fieldRow.setNullFor", { column: column.name })}
        onClick={dispatchSetNull}
      >
        {t("fieldRow.setNull")}
      </button>
    </div>
  );
}
