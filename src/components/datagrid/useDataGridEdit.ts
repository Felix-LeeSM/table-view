import { useState, useCallback, useEffect } from "react";
import { useTabStore } from "@stores/tabStore";
import { useCommitFlash } from "@/hooks/useCommitFlash";
import { useDataGridSelection } from "@/hooks/useDataGridSelection";
import { useDataGridPreviewCommit } from "@/hooks/useDataGridPreviewCommit";
import type { TableData } from "@/types/schema";
import type { MqlPreview } from "@/lib/mongo/mqlGenerator";
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
   * Data paradigm. `rdb` (default) takes the SQL edit path; `document`
   * routes `handleCommit` / `handleExecuteCommit` through the MQL
   * generator + Tauri mutate wrappers so Mongo collections share the
   * same pending state. For `document`, `schema` is the database name
   * and `table` the collection name. `search` / `kv` aren't wired yet.
   */
  paradigm?: "rdb" | "document" | "search" | "kv";
}

/**
 * Surfaced commit failure for the SQL preview modal. Populated by
 * `handleExecuteCommit` on `executeQuery` rejection; `null` means the
 * last commit succeeded (or none has run).
 *
 * - `statementIndex`: 0-indexed position of the failing statement; the
 *   UI re-bases to 1 so users don't see 0-indexed labels.
 * - `statementCount`: batch size — preserves partial-failure context.
 * - `sql` / `message`: failing statement and its DB-reported error.
 * - `failedKey`: optional `pendingEdits` key. When present, the cell is
 *   also flagged in `pendingEditErrors` for an inline hint.
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
   * Per-cell coercion errors keyed by `"rowIdx-colIdx"` (matching
   * {@link pendingEdits}) so cell lookup is O(1). Cleared entry-by-entry
   * on edit, wholesale on successful commit or discard.
   */
  pendingEditErrors: Map<string, string>;

  // SQL preview modal
  sqlPreview: string[] | null;
  setSqlPreview: (v: string[] | null) => void;

  /**
   * Surfaced commit failure. Set on `executeQuery` rejection so the
   * preview modal keeps the batch visible while overlaying the
   * failed-statement banner. Cleared on dismiss or on a fresh
   * `handleCommit`.
   */
  commitError: CommitError | null;
  setCommitError: (v: CommitError | null) => void;

  /**
   * MQL preview for the document paradigm. Populated by `handleCommit`
   * when `paradigm === "document"` and consumed by `handleExecuteCommit`
   * to dispatch insert/update/delete. `null` for RDB.
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

  /**
   * Short-lived flag flipped on at the entry of every commit attempt
   * (Cmd+S listener and toolbar `handleCommit`), cleared when the
   * preview opens, the validation no-op resolves, or a 400ms safety
   * timeout fires. Consumers use it to surface a spinner + aria-busy
   * before the preview modal mounts so Cmd+S has visible feedback in
   * ≤200ms.
   */
  isCommitFlashing: boolean;

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
  /**
   * Warn-tier Safe Mode handoff. Populated when an RDB commit on a
   * production-tagged connection trips warn mode; the consumer surfaces
   * `<ConfirmDestructiveDialog>`. `null` means no pending confirmation.
   */
  pendingConfirm: {
    reason: string;
    sql: string;
    statementIndex: number;
  } | null;
  /** User confirmed: bypass the warn gate and run the batch. */
  confirmDangerous: () => Promise<void>;
  /** User cancelled: surface a warn-tier `commitError`. */
  cancelDangerous: () => void;
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
  const activeTabId = useTabStore((s) => s.activeTabId);
  const promoteTab = useTabStore((s) => s.promoteTab);
  // Surface dirty state to the store so TabBar can render the dirty dot
  // + gate close-on-dirty without coupling to grid internals.
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
  // Per-cell coercion errors populated at commit time when an edit
  // fails `coerceToSqlLiteral`. Entries clear as the user re-edits.
  const [pendingEditErrors, setPendingEditErrors] = useState<
    Map<string, string>
  >(new Map());
  const [pendingNewRows, setPendingNewRows] = useState<unknown[][]>([]);
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<
    Set<string>
  >(new Set());

  // Multi-row selection lives in `useDataGridSelection` so the facade
  // stays paradigm-agnostic.
  const {
    selectedRowIds,
    anchorRowIdx,
    selectedRowIdx,
    handleSelectRow,
    clearSelection,
  } = useDataGridSelection();

  // Reset selection on page change. The selection hook is page-agnostic
  // by design, so this stays in the facade.
  useEffect(() => {
    clearSelection();
  }, [page, clearSelection]);

  // Commit-flash lifecycle (Cmd+S immediate feedback + 400ms safety
  // net + unmount drain) lives in `useCommitFlash`. The facade only
  // watches for terminal signals (preview / commitError) below.
  const { isCommitFlashing, beginCommitFlash, clearCommitFlash } =
    useCommitFlash();

  // Preview / commit / Safe Mode handoff lives in
  // `useDataGridPreviewCommit`: paradigm dispatch, executor, gate
  // consumer, confirm/cancel, and commitError lifecycle. The facade
  // only forwards a cleanup callback and the cell/pending state.
  const clearAllPending = useCallback(() => {
    setPendingEdits(new Map());
    setPendingEditErrors(new Map());
    setPendingNewRows([]);
    setPendingDeletedRowKeys(new Set());
    clearSelection();
    setEditingCell(null);
    setEditValue("");
  }, [clearSelection]);

  const {
    sqlPreview,
    setSqlPreview: setSqlPreviewExposed,
    mqlPreview,
    setMqlPreview,
    commitError,
    setCommitError,
    pendingConfirm,
    handleCommit,
    handleExecuteCommit,
    confirmDangerous,
    cancelDangerous,
    resetPreviewState,
  } = useDataGridPreviewCommit({
    data,
    schema,
    table,
    connectionId,
    page,
    paradigm,
    fetchData,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    setPendingEditErrors,
    clearAllPending,
    beginCommitFlash,
  });

  // Clear the flash as soon as we have a real terminal signal: a preview
  // opened (sqlPreview / mqlPreview transitioned to non-null) or an executor
  // surfaced commitError. We only act when flashing is actually on — without
  // that guard a routine preview-dismiss (`setSqlPreview(null)`) would also
  // clear an unrelated future flash by happenstance.
  useEffect(() => {
    if (!isCommitFlashing) return;
    if (sqlPreview !== null || mqlPreview !== null || commitError !== null) {
      clearCommitFlash();
    }
  }, [isCommitFlashing, sqlPreview, mqlPreview, commitError, clearCommitFlash]);

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

  const handleStartEdit = useCallback(
    (rowIdx: number, colIdx: number, currentValue: string | null) => {
      // Save the existing edit first — `applyEditOrClear` skips the
      // pending entry when the value is unchanged.
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

  // The handlers (handleCommit / handleExecuteCommit / dispatchMqlCommand
  // / runRdbBatch / confirm- / cancelDangerous) live in
  // `useDataGridPreviewCommit`; the facade just forwards them.

  const handleDiscard = useCallback(() => {
    clearAllPending();
    // Discard is the baseline for the next commit cycle — also reset
    // preview / commitError / pendingConfirm in one call.
    resetPreviewState();
  }, [clearAllPending, resetPreviewState]);

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
    clearSelection();
    // Promote preview tab on row delete
    if (activeTabId) promoteTab(activeTabId);
  }, [selectedRowIds, page, activeTabId, promoteTab, clearSelection]);

  const handleDuplicateRow = useCallback(() => {
    if (!data || selectedRowIds.size === 0) return;
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const newRows = sortedIds.map((rowIdx) => {
      const row = data.rows[rowIdx];
      return row ? [...(row as unknown[])] : data.columns.map(() => null);
    });
    setPendingNewRows((prev) => [...prev, ...newRows]);
    clearSelection();
    if (activeTabId) promoteTab(activeTabId);
  }, [data, selectedRowIds, activeTabId, promoteTab, clearSelection]);

  const hasPendingChanges =
    pendingEdits.size > 0 ||
    pendingNewRows.length > 0 ||
    pendingDeletedRowKeys.size > 0 ||
    // The document paradigm parks its dispatch payload in `mqlPreview`
    // until the user confirms — treat an open preview with pending
    // commands as still-pending so commit / Cmd+S stay enabled.
    (mqlPreview !== null && mqlPreview.commands.length > 0);

  // Publish the active tab's dirty state to the tabStore. The dirty signal
  // is narrowed to the three pending diff fields — an open MQL preview
  // alone does not mark the tab dirty, since the modal is its own commit
  // affordance. Cleared on unmount so a stale marker can't outlive the grid.
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
      // Cmd+S with nothing pending → toast instead of a silent no-op (the
      // silent path was inscrutable). No flash — the toast is the feedback.
      if (!hasPendingChanges) {
        toast.info("No changes to commit");
        return;
      }
      // Flip the flash flag at the entry of the event handler so the spinner
      // shows BEFORE handleCommit (which also flips the flag —
      // the duplicate flip is intentionally idempotent and just resets the
      // 400ms safety timer).
      beginCommitFlash();
      // If a cell is being edited, merge its value into pendingEdits and
      // commit with the merged map as override (state is async). When
      // handleCommit reports a preview opened, dismiss the cell editor; on
      // validation failure (`opened: false`) keep the editor so the user
      // can fix the failing value.
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
        setPendingEdits(merged);
        const { opened } = handleCommit({ pendingEditsOverride: merged });
        if (opened) {
          setEditingCell(null);
          setEditValue("");
        }
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
    data,
    handleCommit,
    beginCommitFlash,
  ]);

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
    isCommitFlashing,
    saveCurrentEdit,
    cancelEdit,
    handleStartEdit,
    handleSelectRow,
    handleCommit,
    handleExecuteCommit,
    pendingConfirm,
    confirmDangerous,
    cancelDangerous,
    handleDiscard,
    handleAddRow,
    handleDeleteRow,
    handleDuplicateRow,
  };
}
