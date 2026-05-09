import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTabStore } from "@stores/tabStore";
import {
  useDataGridEditStore,
  entryKey as makeStoreEntryKey,
  EMPTY_ENTRY,
} from "@stores/dataGridEditStore";
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

/**
 * Snapshot of the three pending-state slices captured **before** a mutating
 * handler applies its change. Stored on `undoStack` (ADR 0022 Phase 5,
 * Sprint 249) so the user can step a `Cmd+Z` (or toolbar Undo) back to
 * the prior pending shape without going to the DB. Deep-cloned at push
 * time — the snapshot never aliases live state.
 */
export type EditSnapshot = {
  pendingEdits: ReadonlyMap<string, string | null>;
  pendingNewRows: ReadonlyArray<unknown[]>;
  pendingDeletedRowKeys: ReadonlySet<string>;
};

/**
 * Maximum number of snapshots retained on the undo stack. 50 is
 * intentionally conservative — TablePlus / DBeaver hover around ~100 but
 * for an embedded grid 50 is plenty (a typical session rarely exceeds
 * 10-20 distinct mutations before a commit / discard) and keeps the
 * memory ceiling bounded for `pendingNewRows` / `pendingEdits` deep
 * clones. Older entries are FIFO-dropped via `shift()`.
 */
export const UNDO_STACK_MAX = 50;

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

  /**
   * Pop the most recent {@link EditSnapshot} off the undo stack and
   * restore `pendingEdits` / `pendingNewRows` / `pendingDeletedRowKeys`
   * to that state. No-op when the stack is empty (canUndo=false).
   *
   * Pending range only — commit-time DML is the durable boundary;
   * once committed the user cannot Cmd+Z. ADR 0022 Phase 5 (Sprint 249).
   */
  undo: () => void;
  /** True when there is at least one snapshot to restore. */
  canUndo: boolean;
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

  // Cell editing state — these stay in component-local useState. Only
  // the four pending diff slices (pendingEdits / pendingNewRows /
  // pendingDeletedRowKeys / undoStack) move to the cross-mount store
  // (Sprint 251). `editingCell` / `editValue` are intrinsically per-mount
  // input UI state and reset on remount is desirable.
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState<string | null>("");

  // Per-cell coercion errors populated at commit time when an edit
  // fails `coerceToSqlLiteral`. Entries clear as the user re-edits.
  // Stays in useState — coercion errors are commit-cycle ephemeral and
  // the next mount should start clean.
  const [pendingEditErrors, setPendingEditErrors] = useState<
    Map<string, string>
  >(new Map());

  // Sprint 251 — store-backed pending state. Compose the
  // `(connectionId, schema, table)` entry key once per render. When any
  // of the three identifiers is missing (e.g. a Mongo grid bound before
  // collection load, or any future caller that mounts the hook with
  // empty strings) we fall back to a per-mount instance key so the
  // store remains a pure backing buffer; the previous useState semantics
  // (state resets on remount) are preserved for that edge.
  const fallbackInstanceKeyRef = useRef<string | null>(null);
  if (fallbackInstanceKeyRef.current === null) {
    fallbackInstanceKeyRef.current = `__instance__::${Math.random().toString(36).slice(2)}::${Date.now()}`;
  }
  const storeKey = useMemo(() => {
    if (!connectionId || !schema || !table) {
      return fallbackInstanceKeyRef.current!;
    }
    return makeStoreEntryKey(connectionId, schema, table);
  }, [connectionId, schema, table]);

  // Subscribe to the store entry. Selecting the entry (not individual
  // slices) keeps the four reads coherent — every store mutation
  // produces a new entry object, so each slice read below sees the same
  // snapshot. The `getEntry` reader returns the shared `EMPTY_ENTRY`
  // singleton when missing, so React equality stays stable across
  // identity-preserving renders.
  const entry =
    useDataGridEditStore((s) => s.entries.get(storeKey)) ?? EMPTY_ENTRY;
  const pendingEdits = entry.pendingEdits;
  const pendingNewRows = entry.pendingNewRows;
  const pendingDeletedRowKeys = entry.pendingDeletedRowKeys;
  // Sprint 249 (ADR 0022 Phase 5) — undo stack lives on the store so a
  // tab switch + re-mount preserves the user's history exactly. The
  // 50-entry cap (`UNDO_STACK_MAX`) is enforced in `pushSnapshot` below.
  const undoStack = entry.undoStack;

  // Setter helpers — the inner hook body uses React-style
  // `setState(value | updaterFn)` semantics extensively (e.g.
  // `setPendingEdits((prev) => ...)`). The store API takes plain
  // values, so we wrap each slice setter to accept either form and
  // dispatch through `setSlice`.
  const storeSetSlice = useDataGridEditStore((s) => s.setSlice);
  const storeClearEntry = useDataGridEditStore((s) => s.clearEntry);
  const setPendingEdits = useCallback(
    (
      next:
        | Map<string, string | null>
        | ((prev: Map<string, string | null>) => Map<string, string | null>),
    ) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).pendingEdits;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "pendingEdits", value);
    },
    [storeKey, storeSetSlice],
  );
  const setPendingNewRows = useCallback(
    (next: unknown[][] | ((prev: unknown[][]) => unknown[][])) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).pendingNewRows;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "pendingNewRows", value);
    },
    [storeKey, storeSetSlice],
  );
  const setPendingDeletedRowKeys = useCallback(
    (next: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).pendingDeletedRowKeys;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "pendingDeletedRowKeys", value);
    },
    [storeKey, storeSetSlice],
  );
  const setUndoStack = useCallback(
    (next: EditSnapshot[] | ((prev: EditSnapshot[]) => EditSnapshot[])) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).undoStack;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "undoStack", value);
    },
    [storeKey, storeSetSlice],
  );

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
    // Sprint 251 — `clearEntry` resets all four store-backed slices in
    // a single atomic mutation so subscribers re-render once. Sprint 249
    // semantics preserved: commit success / explicit discard orphans the
    // undo stack (Cmd+Z must not resurrect prior pending state because
    // the DB is the new baseline; discard is itself a "fresh slate").
    storeClearEntry(storeKey);
    setPendingEditErrors(new Map());
    clearSelection();
    setEditingCell(null);
    setEditValue("");
  }, [storeKey, storeClearEntry, clearSelection]);

  /**
   * Push a deep-copied snapshot of the current pending slices onto the
   * undo stack, dropping the oldest entry when over `UNDO_STACK_MAX`.
   *
   * Callers must invoke this BEFORE applying their mutation (so the
   * snapshot reflects the pre-mutation state). For no-op mutations
   * (`saveCurrentEdit` where `applyEditOrClear` returns the same map),
   * callers must skip this so a phantom no-op doesn't pollute the stack.
   */
  const pushSnapshot = useCallback(() => {
    setUndoStack((prev) => {
      const snap: EditSnapshot = {
        // Deep-copy: pendingEdits / pendingNewRows / pendingDeletedRowKeys
        // are referentially-shared with React state; we must clone so a
        // later mutation cannot retroactively edit our snapshot.
        pendingEdits: new Map(pendingEdits),
        pendingNewRows: pendingNewRows.map((row) => [...row]),
        pendingDeletedRowKeys: new Set(pendingDeletedRowKeys),
      };
      const next = [...prev, snap];
      if (next.length > UNDO_STACK_MAX) next.shift();
      return next;
    });
  }, [pendingEdits, pendingNewRows, pendingDeletedRowKeys, setUndoStack]);

  const undo = useCallback(() => {
    setUndoStack((prevStack) => {
      if (prevStack.length === 0) return prevStack;
      const last = prevStack[prevStack.length - 1]!;
      // LIFO restore — clone again on read so external mutation of the
      // restored Map/Array/Set doesn't bleed back into snapshots that
      // remain on the stack from earlier pushes.
      setPendingEdits(new Map(last.pendingEdits));
      setPendingNewRows(last.pendingNewRows.map((row) => [...row]));
      setPendingDeletedRowKeys(new Set(last.pendingDeletedRowKeys));
      return prevStack.slice(0, -1);
    });
  }, [
    setPendingEdits,
    setPendingNewRows,
    setPendingDeletedRowKeys,
    setUndoStack,
  ]);

  const canUndo = undoStack.length > 0;

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
    // Sprint 249: snapshot only when the edit actually changes
    // pendingEdits — `applyEditOrClear` returns the same Map identity
    // for no-ops (open editor + close without typing, or revert to
    // original). We compute the resolved next map up-front so the
    // pre-mutation snapshot lines up with the actual state change.
    const next = applyEditOrClear(pendingEdits, key, editValue, originalValue);
    if (next !== pendingEdits) {
      pushSnapshot();
      setPendingEdits(next);
    }
    setEditingCell(null);
    setEditValue("");
  }, [
    editingCell,
    editValue,
    data,
    pendingEdits,
    pushSnapshot,
    setPendingEdits,
  ]);

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
        // Sprint 249: same no-op skip rule as `saveCurrentEdit` — only
        // snapshot when this auto-save path actually shifts pendingEdits.
        const next = applyEditOrClear(
          pendingEdits,
          key,
          editValue,
          originalValue,
        );
        if (next !== pendingEdits) {
          pushSnapshot();
          setPendingEdits(next);
        }
      }
      setEditingCell({ row: rowIdx, col: colIdx });
      setEditValue(currentValue);
      // Promote preview tab on inline edit start
      if (activeTabId) promoteTab(activeTabId);
    },
    [
      editingCell,
      editValue,
      data,
      activeTabId,
      promoteTab,
      pendingEdits,
      pushSnapshot,
      setPendingEdits,
    ],
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
    // Sprint 249: deliberate user action — always snapshot.
    pushSnapshot();
    const emptyRow = data.columns.map(() => null);
    setPendingNewRows((prev) => [...prev, emptyRow]);
    // Promote preview tab on row add
    if (activeTabId) promoteTab(activeTabId);
  }, [data, activeTabId, promoteTab, pushSnapshot, setPendingNewRows]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRowIds.size === 0) return;
    // Sprint 249: snapshot AFTER the empty-selection guard so a no-op
    // delete (no rows selected) doesn't pollute the stack.
    pushSnapshot();
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
  }, [
    selectedRowIds,
    page,
    activeTabId,
    promoteTab,
    clearSelection,
    pushSnapshot,
    setPendingDeletedRowKeys,
  ]);

  const handleDuplicateRow = useCallback(() => {
    if (!data || selectedRowIds.size === 0) return;
    // Sprint 249: same guard-then-snapshot ordering as `handleDeleteRow`.
    pushSnapshot();
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const newRows = sortedIds.map((rowIdx) => {
      const row = data.rows[rowIdx];
      return row ? [...(row as unknown[])] : data.columns.map(() => null);
    });
    setPendingNewRows((prev) => [...prev, ...newRows]);
    clearSelection();
    if (activeTabId) promoteTab(activeTabId);
  }, [
    data,
    selectedRowIds,
    activeTabId,
    promoteTab,
    clearSelection,
    pushSnapshot,
    setPendingNewRows,
  ]);

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
    setPendingEdits,
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
    undo,
    canUndo,
  };
}
