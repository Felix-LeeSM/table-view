import { useState, useCallback, useEffect } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import type { TableData } from "@/types/schema";
import {
  generateSqlWithKeys,
  type CoerceError,
  type GeneratedSqlStatement,
} from "./sqlGenerator";
import {
  generateMqlPreview,
  type MqlCommand,
  type MqlPreview,
} from "@/lib/mongo/mqlGenerator";
import { insertDocument, updateDocument, deleteDocument } from "@/lib/tauri";
import { toast } from "@/lib/toast";

/**
 * Edit key helper: maps row/col indices to a unique string key.
 */
export function editKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/**
 * Row key helper: identifies a row across pages.
 */
export function rowKeyFn(rowIdx: number, page: number): string {
  return `row-${page}-${rowIdx}`;
}

/**
 * Determine the HTML input type for a given column data type.
 */
export function getInputTypeForColumn(dataType: string): string {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp")) return "datetime-local";
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  return "text";
}

/**
 * Result of {@link deriveEditorSeed}. `accept: false` means the keystroke is
 * not a legal first character for this column type and the caller should
 * swallow the event without changing state (e.g. typing "a" on an integer
 * column). Otherwise the seed is the initial text for the typed editor —
 * which may be `""` for picker-based editors (date/datetime/time/boolean/uuid)
 * where the literal character carries no useful meaning and native pickers
 * do not benefit from a seeded first character.
 *
 * Invariant (ADR 0009): `seed: ""` is an empty string, NOT SQL NULL. Flipping
 * NULL → typed editor seeds with `""` means the editor is now in tri-state
 * "empty string" mode; the user can type to replace it.
 */
export interface EditorSeed {
  seed: string;
  accept: boolean;
}

/**
 * Classify a column's data type family. Matches {@link getInputTypeForColumn}'s
 * lowercasing/includes pattern so classification stays consistent with the
 * HTML input-type rendering.
 */
function classifyDataType(
  dataType: string,
):
  | "integer"
  | "numeric"
  | "date"
  | "datetime"
  | "time"
  | "boolean"
  | "uuid"
  | "text" {
  const lower = dataType.toLowerCase();
  // `timestamp` and `timestamptz` must beat `time` — `timestamp` includes
  // `time` as a substring. Order matters.
  if (lower.includes("timestamp") || lower.includes("datetime")) {
    return "datetime";
  }
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  if (lower === "bool" || lower.includes("boolean")) return "boolean";
  if (lower.includes("uuid")) return "uuid";
  // Integer family — check before numeric so `bigint` doesn't get trapped by
  // a future `numeric` contains-check ordering bug. `int` catches int, int4,
  // int8, integer, bigint, smallint, tinyint, mediumint.
  if (
    lower.includes("int") ||
    lower === "serial" ||
    lower === "bigserial" ||
    lower === "smallserial"
  ) {
    return "integer";
  }
  if (
    lower.includes("numeric") ||
    lower.includes("decimal") ||
    lower.includes("float") ||
    lower.includes("double") ||
    lower.includes("real")
  ) {
    return "numeric";
  }
  return "text";
}

/**
 * Given a column's data type and a printable keystroke, decide whether to
 * resume editing (and with what seed) when the user types from the NULL chip
 * state. Separate from {@link getInputTypeForColumn} because the HTML input
 * type is decided purely by column family, while the seed depends on both
 * family AND the pressed key.
 *
 * Rules:
 * - text/json/unknown: seed = key, accept = true (legacy behaviour).
 * - integer: accept only digits and leading `-`; reject `.` and anything else.
 * - numeric: accept digits, `-`, and `.`.
 * - date/datetime/time/boolean/uuid: accept = true but seed = `""` — native
 *   pickers and coercion-based editors do not benefit from a seeded first
 *   character, and for boolean the literal character is usually unrelated
 *   to the final `true`/`false` value anyway.
 *
 * All matching is case-insensitive and uses substring matches consistent with
 * {@link getInputTypeForColumn}.
 */
export function deriveEditorSeed(dataType: string, key: string): EditorSeed {
  const family = classifyDataType(dataType);
  switch (family) {
    case "integer": {
      // Legal integer first chars: digit or leading minus. Reject `.` (decimals
      // belong to numeric/float) and any letter/punctuation.
      if (/^[0-9-]$/.test(key)) return { seed: key, accept: true };
      return { seed: "", accept: false };
    }
    case "numeric": {
      // Legal numeric first chars: digit, leading minus, leading decimal point.
      if (/^[0-9.-]$/.test(key)) return { seed: key, accept: true };
      return { seed: "", accept: false };
    }
    case "date":
    case "datetime":
    case "time":
    case "boolean":
    case "uuid": {
      // Picker / coercion editors — flip into an empty typed editor and let
      // the user interact via the native control (or re-type). We still
      // accept the event so the NULL chip transitions out; the literal
      // character is intentionally discarded.
      return { seed: "", accept: true };
    }
    case "text":
    default:
      return { seed: key, accept: true };
  }
}

/**
 * Render a raw cell value as a displayable string.
 * NULL collapses to `""` — use only for tooltip/title or read-only display
 * where that's acceptable. For edit flows, prefer `cellToEditValue`.
 */
export function cellToEditString(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "object") return JSON.stringify(cell, null, 2);
  return String(cell);
}

/**
 * Edit-path counterpart of `cellToEditString`. Preserves SQL NULL intent:
 * a null/undefined cell returns `null`, an empty-string cell returns `""`.
 * Downstream code can then distinguish `SET col = NULL` from `SET col = ''`.
 */
export function cellToEditValue(cell: unknown): string | null {
  if (cell == null) return null;
  if (typeof cell === "object") return JSON.stringify(cell, null, 2);
  return String(cell);
}

/**
 * Apply a cell edit, but skip (or remove) the pending entry when the value
 * matches the original cell — opening and closing an editor without typing,
 * or undoing a change back to the original, should not leave a phantom
 * pending state behind. `null` is a first-class value representing explicit
 * SQL NULL intent; `null === null` is a "no change" when the cell was NULL.
 */
function applyEditOrClear(
  prev: Map<string, string | null>,
  key: string,
  value: string | null,
  originalValue: string | null,
): Map<string, string | null> {
  if (value === originalValue) {
    if (!prev.has(key)) return prev;
    const next = new Map(prev);
    next.delete(key);
    return next;
  }
  const next = new Map(prev);
  next.set(key, value);
  return next;
}

export interface UseDataGridEditParams {
  data: TableData | null;
  schema: string;
  table: string;
  connectionId: string;
  page: number;
  fetchData: () => void;
  /**
   * Data paradigm of the grid. `"rdb"` (default) keeps the SQL edit path.
   * `"document"` (Sprint 86) routes `handleCommit` / `handleExecuteCommit`
   * through the MQL generator + Tauri mutate wrappers so a Mongo collection
   * grid can propose insert/update/delete operations with the same pending
   * state the RDB grid uses. `search` / `kv` are not yet wired to this hook.
   *
   * For the document paradigm the hook treats the `schema` argument as the
   * MongoDB database name and `table` as the collection name — the two
   * coordinates that `insertDocument` / `updateDocument` / `deleteDocument`
   * need. Sprint 87 will pass these explicitly; Sprint 86 only consumes the
   * existing argument shape so the RDB callers do not break.
   */
  paradigm?: "rdb" | "document" | "search" | "kv";
}

/**
 * Sprint 93 — surfaced commit failure for the SQL preview modal. Populated by
 * `handleExecuteCommit` when an `executeQuery` call rejects. `null` means the
 * last commit succeeded (or no commit has run yet).
 *
 * Fields:
 * - `statementIndex`: 0-indexed position of the failing statement in
 *   `sqlPreview`. The UI converts this to a 1-indexed "failed at: K" label
 *   so non-developers don't trip on 0-vs-1 indexing.
 * - `statementCount`: total statements in the batch — used to show
 *   "executed: N, failed at: K" so partial-failure context is preserved.
 * - `sql`: raw SQL text of the failing statement so the user can see exactly
 *   what was sent to the DB.
 * - `message`: DB-reported error message (or fallback string when the reject
 *   value isn't an Error/string).
 * - `failedKey`: optional pendingEdits key for the failing statement. When
 *   present, the cell is also flagged in `pendingEditErrors` so an inline
 *   hint appears next to the offending cell.
 */
export interface CommitError {
  statementIndex: number;
  statementCount: number;
  sql: string;
  message: string;
  failedKey?: string;
}

export interface DataGridEditState {
  // Cell editing
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  setEditValue: (v: string | null) => void;
  setEditNull: () => void;

  // Pending changes
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;

  /**
   * Sprint 75 — per-cell validation errors produced when a pending edit's
   * value could not be coerced to its column's data type at commit time.
   * Keyed by the same `"rowIdx-colIdx"` shape as {@link pendingEdits} so the
   * UI can look up the error for the active cell in O(1). Cleared entry-by-
   * entry when the user edits the cell, and wholesale on a successful commit
   * or `handleDiscard`.
   */
  pendingEditErrors: Map<string, string>;

  // SQL preview modal
  sqlPreview: string[] | null;
  setSqlPreview: (v: string[] | null) => void;

  /**
   * Sprint 93 — surfaced commit failure. Set when `handleExecuteCommit`'s
   * `executeQuery` loop rejects so the SQL preview modal can keep showing
   * the batch and overlay the failed-statement banner. Cleared by
   * `setCommitError(null)` (the user dismissing the banner) or by a fresh
   * `handleCommit` (re-opening the preview with a new batch).
   */
  commitError: CommitError | null;
  setCommitError: (v: CommitError | null) => void;

  /**
   * MQL preview for the document paradigm (Sprint 86). Populated by
   * `handleCommit` when `paradigm === "document"` and consumed by
   * `handleExecuteCommit` to dispatch insert/update/delete Tauri commands.
   * Null for the RDB paradigm. Sprint 87 will render this in the
   * generalised preview modal alongside `sqlPreview.previewLines`.
   */
  mqlPreview: MqlPreview | null;
  setMqlPreview: (v: MqlPreview | null) => void;

  // Row selection (multi-row)
  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;

  // Derived — backward compat: single selected row index
  selectedRowIdx: number | null;

  // Derived
  hasPendingChanges: boolean;

  // Actions
  saveCurrentEdit: () => void;
  cancelEdit: () => void;
  handleStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
  handleSelectRow: (
    rowIdx: number,
    metaKey: boolean,
    shiftKey: boolean,
  ) => void;
  handleCommit: () => void;
  handleExecuteCommit: () => Promise<void>;
  handleDiscard: () => void;
  handleAddRow: () => void;
  handleDeleteRow: () => void;
  handleDuplicateRow: () => void;
}

export function useDataGridEdit({
  data,
  schema,
  table,
  connectionId,
  page,
  fetchData,
  paradigm = "rdb",
}: UseDataGridEditParams): DataGridEditState {
  const executeQuery = useSchemaStore((s) => s.executeQuery);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const promoteTab = useTabStore((s) => s.promoteTab);
  // Sprint 97 — surface dirty state to the store so TabBar can render a
  // dirty dot + gate close-on-dirty without coupling to grid internals.
  const setTabDirty = useTabStore((s) => s.setTabDirty);

  // Cell editing state
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState<string | null>("");
  const [pendingEdits, setPendingEdits] = useState<Map<string, string | null>>(
    new Map(),
  );
  // Sprint 75 — per-cell coercion-error map. Populated during commit when a
  // pending edit fails `coerceToSqlLiteral`; cleared entry-by-entry when the
  // user modifies the cell via `setEditValue`/`setEditNull`.
  const [pendingEditErrors, setPendingEditErrors] = useState<
    Map<string, string>
  >(new Map());

  // SQL preview modal state
  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);
  // Sprint 93 — keyed statements that produced `sqlPreview`. Kept in lockstep
  // with `sqlPreview` (every `setSqlPreview(...)` call has a matching
  // `setSqlPreviewStatements(...)` so the two arrays never drift). Used by
  // `handleExecuteCommit` to map a failing statement index back to the
  // pending-edit cell key.
  const [sqlPreviewStatements, setSqlPreviewStatements] = useState<
    GeneratedSqlStatement[] | null
  >(null);
  // Sprint 93 — commit error state for the SQL branch. Populated only when
  // `handleExecuteCommit` catches a rejected `executeQuery`; cleared on
  // successful commit, on `handleDiscard`, and when a fresh `handleCommit`
  // re-opens the preview with a new batch.
  const [commitError, setCommitError] = useState<CommitError | null>(null);
  // Sprint 86 — parallel MQL preview state for the document paradigm. Lives
  // next to `sqlPreview` so `hasPendingChanges` and the commit shortcut can
  // reason about both in a single place. Mutually exclusive in practice: a
  // single grid is either RDB or document, never both.
  const [mqlPreview, setMqlPreview] = useState<MqlPreview | null>(null);

  // Sprint 93 — wrapped setter exposed to consumers. When the caller dismisses
  // the SQL preview modal (passing `null`), we also clear the keyed-statement
  // list and any surfaced commit failure so a re-open starts clean. Setting a
  // new array goes through unchanged for backwards compatibility.
  const setSqlPreviewExposed = useCallback((v: string[] | null) => {
    setSqlPreview(v);
    if (v === null) {
      setSqlPreviewStatements(null);
      setCommitError(null);
    }
  }, []);

  // Row selection state (multi-row)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const [anchorRowIdx, setAnchorRowIdx] = useState<number | null>(null);

  // Reset selection when page changes
  useEffect(() => {
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
  }, [page]);

  const [pendingNewRows, setPendingNewRows] = useState<unknown[][]>([]);
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<
    Set<string>
  >(new Set());

  const saveCurrentEdit = useCallback(() => {
    if (!editingCell) return;
    const key = editKey(editingCell.row, editingCell.col);
    const originalCell = data?.rows[editingCell.row]?.[editingCell.col];
    const originalValue = cellToEditValue(originalCell);
    setPendingEdits((prev) =>
      applyEditOrClear(prev, key, editValue, originalValue),
    );
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue, data]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  /**
   * Clear the coercion-error entry (if any) for the currently editing cell.
   * Called whenever the user modifies the active cell's value so the inline
   * hint disappears in response to input — the user has acknowledged the error
   * by editing. The error will reappear on the next commit only if the new
   * value also fails coercion.
   */
  const clearActiveEditorError = useCallback(() => {
    setPendingEditErrors((prev) => {
      if (prev.size === 0 || !editingCell) return prev;
      const key = editKey(editingCell.row, editingCell.col);
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, [editingCell]);

  const setEditValueWithErrorClear = useCallback(
    (v: string | null) => {
      setEditValue(v);
      clearActiveEditorError();
    },
    [clearActiveEditorError],
  );

  const setEditNull = useCallback(() => {
    setEditValue(null);
    clearActiveEditorError();
  }, [clearActiveEditorError]);

  const handleSelectRow = useCallback(
    (rowIdx: number, metaKey: boolean, shiftKey: boolean) => {
      if (metaKey) {
        // Cmd/Ctrl+Click: toggle individual row
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowIdx)) {
            next.delete(rowIdx);
          } else {
            next.add(rowIdx);
          }
          return next;
        });
        // Set anchor if this is the first selection
        setAnchorRowIdx((prev) => (prev === null ? rowIdx : prev));
      } else if (shiftKey && anchorRowIdx !== null) {
        // Shift+Click with anchor: range selection
        const start = Math.min(anchorRowIdx, rowIdx);
        const end = Math.max(anchorRowIdx, rowIdx);
        const range = new Set<number>();
        for (let i = start; i <= end; i++) {
          range.add(i);
        }
        setSelectedRowIds(range);
      } else if (shiftKey && anchorRowIdx === null) {
        // Shift+Click without anchor: fallback to single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      } else {
        // Normal click: single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      }
    },
    [anchorRowIdx],
  );

  const handleStartEdit = useCallback(
    (rowIdx: number, colIdx: number, currentValue: string | null) => {
      // Sprint 86: the document paradigm now participates in editing. Earlier
      // sprints returned a no-op here because write support was not wired;
      // Sprint 86 introduces the MQL generator + dispatch branch (see
      // `handleCommit` / `handleExecuteCommit` below) so `editingCell` +
      // `editValue` are set for every paradigm. Sprint 87 will hide
      // sentinel/composite cells at the UI layer — the generator already
      // guards against committing a sentinel edit.

      // Save any existing edit first — but skip pending when value unchanged
      if (editingCell) {
        const key = editKey(editingCell.row, editingCell.col);
        const originalCell = data?.rows[editingCell.row]?.[editingCell.col];
        const originalValue = cellToEditValue(originalCell);
        setPendingEdits((prev) =>
          applyEditOrClear(prev, key, editValue, originalValue),
        );
      }
      setEditingCell({ row: rowIdx, col: colIdx });
      setEditValue(currentValue);
      // Promote preview tab on inline edit start
      if (activeTabId) promoteTab(activeTabId);
    },
    [editingCell, editValue, data, activeTabId, promoteTab],
  );

  const handleCommit = useCallback(() => {
    if (!data) return;
    if (paradigm === "document") {
      // Sprint 86 — document paradigm dispatch. The MQL generator accepts the
      // same pending diff shape the RDB path uses, but expects record-keyed
      // new rows so each insert's document layout is explicit. We
      // reconstruct records from positional `pendingNewRows` using the
      // current column layout; cells that are still `null` / `undefined` are
      // dropped so the Tauri payload matches what JSON serialisation
      // allows. `schema` / `table` double as MongoDB database / collection
      // names — Sprint 87 will pass these via dedicated props.
      const columns = data.columns.map((c) => ({
        name: c.name,
        data_type: c.data_type,
        is_primary_key: c.is_primary_key,
      }));
      const insertRecords: Record<string, unknown>[] = pendingNewRows.map(
        (row) => {
          const record: Record<string, unknown> = {};
          columns.forEach((col, idx) => {
            const value = row[idx];
            if (value !== null && value !== undefined) {
              record[col.name] = value;
            }
          });
          return record;
        },
      );
      const preview = generateMqlPreview({
        database: schema,
        collection: table,
        columns,
        rows: data.rows,
        page,
        pendingEdits,
        pendingDeletedRowKeys,
        pendingNewRows: insertRecords,
      });
      // Clear RDB-shaped per-cell errors — the MQL path reports per-row
      // errors on the preview itself, not through `pendingEditErrors`.
      setPendingEditErrors(new Map());
      if (preview.commands.length === 0) {
        // Expose the preview even if empty so callers can inspect errors.
        // Only open it when there's something actionable.
        return;
      }
      setMqlPreview(preview);
      return;
    }
    // Collect coercion failures in a fresh map so the commit-time view replaces
    // (not appends to) any stale errors from a previous batch — each commit is
    // a complete re-validation of the current pending state.
    const nextErrors = new Map<string, string>();
    const keyedStatements = generateSqlWithKeys(
      data,
      schema,
      table,
      pendingEdits,
      pendingDeletedRowKeys,
      pendingNewRows,
      {
        onCoerceError: (err: CoerceError) => {
          nextErrors.set(err.key, err.message);
        },
      },
    );
    setPendingEditErrors(nextErrors);
    if (keyedStatements.length === 0) return;
    setSqlPreview(keyedStatements.map((s) => s.sql));
    setSqlPreviewStatements(keyedStatements);
    // Reset any previous commit failure so the preview opens clean.
    setCommitError(null);
  }, [
    data,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
    schema,
    table,
    paradigm,
    page,
  ]);

  const dispatchMqlCommand = useCallback(
    async (cmd: MqlCommand): Promise<void> => {
      switch (cmd.kind) {
        case "insertOne":
          await insertDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.document,
          );
          return;
        case "updateOne":
          await updateDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.documentId,
            cmd.patch,
          );
          return;
        case "deleteOne":
          await deleteDocument(
            connectionId,
            cmd.database,
            cmd.collection,
            cmd.documentId,
          );
          return;
        default: {
          // Exhaustiveness guard — adding a new MqlCommand variant without
          // updating this switch will fail to compile.
          const never: never = cmd;
          return never;
        }
      }
    },
    [connectionId],
  );

  const handleExecuteCommit = useCallback(async () => {
    if (paradigm === "document") {
      if (!mqlPreview || mqlPreview.commands.length === 0) return;
      const docCount = mqlPreview.commands.length;
      try {
        for (const cmd of mqlPreview.commands) {
          await dispatchMqlCommand(cmd);
        }
        setMqlPreview(null);
        setPendingEdits(new Map());
        setPendingEditErrors(new Map());
        setPendingNewRows([]);
        setPendingDeletedRowKeys(new Set());
        setSelectedRowIds(new Set());
        setAnchorRowIdx(null);
        setEditingCell(null);
        setEditValue("");
        fetchData();
        // Sprint 94 — surface the success so document-paradigm commits don't
        // disappear silently into the schema tree refresh.
        toast.success(
          `${docCount} document ${docCount === 1 ? "change" : "changes"} committed.`,
        );
      } catch (err) {
        // Sprint 94 — MQL branch was previously a silent swallow. We still
        // don't have the rich `commitError` plumbing the SQL branch enjoys
        // (Sprint 93 only wired SQL), but at least surface the failure as a
        // toast so the user is never left wondering why their commit didn't
        // take. The catch-audit (sprint-88) requires a comment + a recovery
        // action — the toast is that action.
        const message =
          err instanceof Error
            ? err.message
            : typeof err === "string"
              ? err
              : "Failed to commit document changes.";
        toast.error(`Commit failed: ${message}`);
      }
      return;
    }
    if (!sqlPreview) return;
    // Prefer the keyed statement list (set in lockstep with `sqlPreview`) so a
    // commit failure can route back to the offending cell. Fall back to a
    // key-less view of `sqlPreview` if the keyed list is somehow absent — this
    // keeps the catch block safe even in the (theoretical) event of state
    // skew between the two parallel arrays.
    const statements: GeneratedSqlStatement[] =
      sqlPreviewStatements ?? sqlPreview.map((sql) => ({ sql }));
    const statementCount = statements.length;
    let executedCount = 0;
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i]!;
        try {
          await executeQuery(connectionId, stmt.sql, `edit-${Date.now()}`);
          executedCount = i + 1;
        } catch (err) {
          // Sprint 93 — surface the failure instead of swallowing it. We keep
          // `sqlPreview` populated (no `setSqlPreview(null)`) so the modal
          // stays open with the failed-statement banner. `pendingEditErrors`
          // gets the failed cell key so the inline hint also lights up when
          // the user dismisses the modal.
          const message =
            err instanceof Error
              ? err.message
              : typeof err === "string"
                ? err
                : "Failed to execute statement.";
          setCommitError({
            statementIndex: i,
            statementCount,
            sql: stmt.sql,
            message: `executed: ${executedCount}, failed at: ${i + 1} of ${statementCount} — ${message}`,
            failedKey: stmt.key,
          });
          if (stmt.key) {
            setPendingEditErrors((prev) => {
              const next = new Map(prev);
              next.set(stmt.key!, message);
              return next;
            });
          }
          // Sprint 94 — surface the failure as a toast so the user still sees
          // the failure context if they dismiss the SQL Preview modal. The
          // toast lives outside the modal portal, so it survives the close
          // (AC-03). The message intentionally embeds the partial-failure
          // counts ("executed: N, failed at: K") to satisfy AC-02.
          toast.error(
            `Commit failed (executed: ${executedCount}, failed at: ${i + 1} of ${statementCount}): ${message}`,
          );
          // Stop on first failure — `executeQuery` runs statements serially
          // outside a transaction, so already-applied statements stay applied.
          // The user can re-open the preview after fixing the failed row.
          return;
        }
      }
      // Happy path: all statements succeeded.
      setSqlPreview(null);
      setSqlPreviewStatements(null);
      setCommitError(null);
      setPendingEdits(new Map());
      setPendingEditErrors(new Map());
      setPendingNewRows([]);
      setPendingDeletedRowKeys(new Set());
      setSelectedRowIds(new Set());
      setAnchorRowIdx(null);
      // Any cell editor that moved along with Tab/Enter during commit is now
      // stale (pointing at soon-to-be-refetched data). Close it.
      setEditingCell(null);
      setEditValue("");
      // Refresh data
      fetchData();
      // Sprint 94 — success toast. AC-02 calls for "commit success" coverage;
      // we report the statement count so a multi-row commit is visibly
      // summarised.
      toast.success(
        `${statementCount} ${statementCount === 1 ? "change" : "changes"} committed.`,
      );
    } catch (err) {
      // Defensive outer catch — the inner try/catch already handles
      // `executeQuery` rejections. This branch only runs if a synchronous
      // throw escapes the loop (e.g. a programming error inside the loop
      // body). Surface it through the same channel so the user is never left
      // with a silent failure. Empty catch is explicitly forbidden here
      // (sprint-93 / sprint-88 catch-audit).
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Unexpected commit failure.";
      setCommitError({
        statementIndex: executedCount,
        statementCount,
        sql: statements[executedCount]?.sql ?? "",
        message: `executed: ${executedCount}, failed at: ${executedCount + 1} of ${statementCount} — ${message}`,
      });
      // Sprint 94 — also surface defensive-catch failures as a toast so the
      // user is not left guessing if the modal is dismissed.
      toast.error(
        `Commit failed (executed: ${executedCount}, failed at: ${executedCount + 1} of ${statementCount}): ${message}`,
      );
    }
  }, [
    sqlPreview,
    sqlPreviewStatements,
    mqlPreview,
    executeQuery,
    connectionId,
    fetchData,
    paradigm,
    dispatchMqlCommand,
  ]);

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map());
    setPendingEditErrors(new Map());
    setEditingCell(null);
    setEditValue("");
    setPendingNewRows([]);
    setPendingDeletedRowKeys(new Set());
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
    // Sprint 86 — clear the MQL preview alongside the pending diff so a
    // subsequent commit doesn't replay stale commands in the document
    // paradigm. No-op for RDB grids (mqlPreview is always null there).
    setMqlPreview(null);
    // Sprint 93 — wipe any surfaced commit failure so a fresh commit starts
    // clean and the dismissed banner doesn't reappear on re-open.
    setSqlPreviewStatements(null);
    setCommitError(null);
  }, []);

  const handleAddRow = useCallback(() => {
    if (!data) return;
    const emptyRow = data.columns.map(() => null);
    setPendingNewRows((prev) => [...prev, emptyRow]);
    // Promote preview tab on row add
    if (activeTabId) promoteTab(activeTabId);
  }, [data, activeTabId, promoteTab]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRowIds.size === 0) return;
    setPendingDeletedRowKeys((prev) => {
      const next = new Set(prev);
      selectedRowIds.forEach((rowIdx) => {
        const rk = rowKeyFn(rowIdx, page);
        next.add(rk);
      });
      return next;
    });
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
    // Promote preview tab on row delete
    if (activeTabId) promoteTab(activeTabId);
  }, [selectedRowIds, page, activeTabId, promoteTab]);

  const handleDuplicateRow = useCallback(() => {
    if (!data || selectedRowIds.size === 0) return;
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const newRows = sortedIds.map((rowIdx) => {
      const row = data.rows[rowIdx];
      return row ? [...(row as unknown[])] : data.columns.map(() => null);
    });
    setPendingNewRows((prev) => [...prev, ...newRows]);
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
    if (activeTabId) promoteTab(activeTabId);
  }, [data, selectedRowIds, activeTabId, promoteTab]);

  const hasPendingChanges =
    pendingEdits.size > 0 ||
    pendingNewRows.length > 0 ||
    pendingDeletedRowKeys.size > 0 ||
    // Sprint 86 — the document paradigm parks its dispatch payload in
    // `mqlPreview` until the user confirms the preview modal. Treat an
    // open preview with pending commands as "changes still pending" so
    // the commit button / Cmd+S shortcut stay enabled.
    (mqlPreview !== null && mqlPreview.commands.length > 0);

  // Sprint 97 — publish the active tab's dirty state to the tabStore. We
  // narrow the dirty signal to the three pending diff fields the contract
  // calls out (`pendingEdits`, `pendingNewRows`, `pendingDeletedRowKeys`)
  // so an open MQL preview alone does NOT mark the tab dirty — the modal
  // itself acts as the user's commit affordance for that branch. On unmount
  // (tab switch) we clear the marker so a stale entry can't survive the
  // grid teardown.
  useEffect(() => {
    if (!activeTabId) return;
    const isDirty =
      pendingEdits.size > 0 ||
      pendingNewRows.length > 0 ||
      pendingDeletedRowKeys.size > 0;
    setTabDirty(activeTabId, isDirty);
    return () => {
      setTabDirty(activeTabId, false);
    };
  }, [
    activeTabId,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    setTabDirty,
  ]);

  // Listen for global Cmd+S commit shortcut. Only the active tab's grid
  // should react — gate on activeTabId being present and pending changes
  // existing. Otherwise the dispatch is silently ignored (idempotent).
  useEffect(() => {
    const handler = () => {
      if (!hasPendingChanges) return;
      // If a cell is being edited, persist its value before opening preview —
      // but only if the value actually differs from the original.
      if (editingCell) {
        if (!data) return;
        const key = editKey(editingCell.row, editingCell.col);
        const originalCell = data.rows[editingCell.row]?.[editingCell.col];
        const originalValue = cellToEditValue(originalCell);
        const merged = applyEditOrClear(
          pendingEdits,
          key,
          editValue,
          originalValue,
        );
        const nextErrors = new Map<string, string>();
        const keyedStatements = generateSqlWithKeys(
          data,
          schema,
          table,
          merged,
          pendingDeletedRowKeys,
          pendingNewRows,
          {
            onCoerceError: (err: CoerceError) => {
              nextErrors.set(err.key, err.message);
            },
          },
        );
        setPendingEditErrors(nextErrors);
        if (keyedStatements.length === 0) {
          // Preserve the pending edit so the user sees the failing value
          // (and the inline hint) instead of silently losing it.
          setPendingEdits(merged);
          return;
        }
        setPendingEdits(merged);
        setEditingCell(null);
        setEditValue("");
        setSqlPreview(keyedStatements.map((s) => s.sql));
        setSqlPreviewStatements(keyedStatements);
        // Reset any previous commit failure so the preview opens clean.
        setCommitError(null);
        return;
      }
      handleCommit();
    };
    window.addEventListener("commit-changes", handler);
    return () => window.removeEventListener("commit-changes", handler);
  }, [
    hasPendingChanges,
    editingCell,
    editValue,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
    data,
    schema,
    table,
    handleCommit,
  ]);

  // Derived: single selected row index (backward compat)
  const selectedRowIdx =
    selectedRowIds.size === 1 ? [...selectedRowIds][0]! : null;

  return {
    editingCell,
    editValue,
    setEditValue: setEditValueWithErrorClear,
    setEditNull,
    pendingEdits,
    pendingEditErrors,
    pendingNewRows,
    pendingDeletedRowKeys,
    sqlPreview,
    setSqlPreview: setSqlPreviewExposed,
    commitError,
    setCommitError,
    mqlPreview,
    setMqlPreview,
    selectedRowIds,
    anchorRowIdx,
    selectedRowIdx,
    hasPendingChanges,
    saveCurrentEdit,
    cancelEdit,
    handleStartEdit,
    handleSelectRow,
    handleCommit,
    handleExecuteCommit,
    handleDiscard,
    handleAddRow,
    handleDeleteRow,
    handleDuplicateRow,
  };
}
