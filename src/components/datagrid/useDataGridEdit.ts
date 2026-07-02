import { useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  useActiveTabId,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
} from "@stores/workspaceStore";
import { useCommitFlash } from "@/hooks/useCommitFlash";
import { useDataGridSelection } from "@/hooks/useDataGridSelection";
import { useDataGridPreviewCommit } from "@/hooks/useDataGridPreviewCommit";
import { toast } from "@/lib/runtime/toast";
import { useDataGridEditPendingState } from "./useDataGridEditPendingState";
import type {
  DataGridEditState,
  UseDataGridEditParams,
} from "./dataGridEditTypes";
import {
  applyEditOrClear,
  cellToEditValue,
  editKey,
  rowKeyFn,
} from "./dataGridEditFsm";

export {
  cellToEditString,
  cellToEditValue,
  deriveEditorSeed,
  editKey,
  getInputTypeForColumn,
  rowKeyFn,
  UNDO_STACK_MAX,
} from "./dataGridEditFsm";
export type { CommitError, EditorSeed, EditSnapshot } from "./dataGridEditFsm";
export type {
  DataGridEditState,
  UseDataGridEditParams,
} from "./dataGridEditTypes";

export function useDataGridEdit({
  data,
  database,
  schema,
  table,
  connectionId,
  page,
  fetchData,
  paradigm = "rdb",
  canEditRows = true,
}: UseDataGridEditParams): DataGridEditState {
  const { t } = useTranslation("datagrid");
  const activeTabId = useActiveTabId();
  const workspaceKey = useCurrentWorkspaceKey();
  const promoteTabAction = useWorkspaceStore((s) => s.promoteTab);
  const setTabDirtyAction = useWorkspaceStore((s) => s.setTabDirty);
  const promoteTab = useCallback(
    (tabId: string) => {
      if (!workspaceKey) return;
      promoteTabAction(workspaceKey.connId, workspaceKey.db, tabId);
    },
    [workspaceKey, promoteTabAction],
  );
  // Surface dirty state to the store so TabBar can render the dirty dot
  // + gate close-on-dirty without coupling to grid internals.
  const setTabDirty = useCallback(
    (tabId: string, dirty: boolean) => {
      if (!workspaceKey) return;
      setTabDirtyAction(workspaceKey.connId, workspaceKey.db, tabId, dirty);
    },
    [workspaceKey, setTabDirtyAction],
  );

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

  const {
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    pendingEditRowSnapshots,
    pendingDeletedRowSnapshots,
    setPendingEdits,
    setPendingNewRows,
    setPendingDeletedRowKeys,
    captureEditRowSnapshot,
    captureDeletedRowSnapshot,
    clearPendingEntry,
    pushSnapshot,
    undo,
    canUndo,
  } = useDataGridEditPendingState({
    connectionId,
    database,
    schema,
    table,
  });

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
    clearPendingEntry();
    setPendingEditErrors(new Map());
    clearSelection();
    setEditingCell(null);
    setEditValue("");
  }, [clearPendingEntry, clearSelection]);

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
    database,
    schema,
    table,
    connectionId,
    page,
    paradigm,
    fetchData,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    pendingEditRowSnapshots,
    pendingDeletedRowSnapshots,
    canEditRows,
    setPendingEditErrors,
    clearAllPending,
    beginCommitFlash,
  });

  useEffect(() => {
    if (canEditRows) return;
    clearAllPending();
    resetPreviewState();
  }, [canEditRows, clearAllPending, resetPreviewState]);

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
    if (!canEditRows) {
      setEditingCell(null);
      setEditValue("");
      return;
    }
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
      // Issue #1081 — anchor this row's identity while `data` still shows
      // the page it was edited on. Skip when the edit reverted to original
      // (`next` dropped the key) — there is no pending edit to anchor.
      if (next.has(key) && data) {
        const row = data.rows[editingCell.row] as unknown[] | undefined;
        if (row) captureEditRowSnapshot(editingCell.row, row);
      }
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
    captureEditRowSnapshot,
    canEditRows,
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
      if (!canEditRows) return;
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
          // Issue #1081 — anchor the auto-saved row's identity (see
          // `saveCurrentEdit`).
          if (next.has(key) && data) {
            const row = data.rows[editingCell.row] as unknown[] | undefined;
            if (row) captureEditRowSnapshot(editingCell.row, row);
          }
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
      captureEditRowSnapshot,
      canEditRows,
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
    if (!canEditRows) return;
    if (!data) return;
    // Sprint 249: deliberate user action — always snapshot.
    pushSnapshot();
    const emptyRow = data.columns.map(() => null);
    setPendingNewRows((prev) => [...prev, emptyRow]);
    // Promote preview tab on row add
    if (activeTabId) promoteTab(activeTabId);
  }, [
    canEditRows,
    data,
    activeTabId,
    promoteTab,
    pushSnapshot,
    setPendingNewRows,
  ]);

  const handleDeleteRow = useCallback(() => {
    if (!canEditRows) return;
    if (selectedRowIds.size === 0) return;
    // Sprint 249: snapshot AFTER the empty-selection guard so a no-op
    // delete (no rows selected) doesn't pollute the stack.
    pushSnapshot();
    setPendingDeletedRowKeys((prev) => {
      const next = new Set(prev);
      selectedRowIds.forEach((rowIdx) => {
        const rk = rowKeyFn(rowIdx, page);
        next.add(rk);
        // Issue #1081 — anchor the deleted row's identity now, while
        // `data.rows[rowIdx]` still points at the row the user selected.
        const row = data?.rows[rowIdx] as unknown[] | undefined;
        if (row) captureDeletedRowSnapshot(rk, row);
      });
      return next;
    });
    clearSelection();
    // Promote preview tab on row delete
    if (activeTabId) promoteTab(activeTabId);
  }, [
    selectedRowIds,
    page,
    data,
    activeTabId,
    promoteTab,
    clearSelection,
    pushSnapshot,
    setPendingDeletedRowKeys,
    captureDeletedRowSnapshot,
    canEditRows,
  ]);

  const handleDuplicateRow = useCallback(() => {
    if (!canEditRows) return;
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
    canEditRows,
  ]);

  const hasPendingChanges =
    canEditRows &&
    (pendingEdits.size > 0 ||
      pendingNewRows.length > 0 ||
      pendingDeletedRowKeys.size > 0 ||
      // The document paradigm parks its dispatch payload in `mqlPreview`
      // until the user confirms — treat an open preview with pending
      // commands as still-pending so commit / Cmd+S stay enabled.
      (mqlPreview !== null && mqlPreview.commands.length > 0));

  // Publish the active tab's dirty state to the tabStore. The dirty signal
  // is narrowed to the three pending diff fields — an open MQL preview
  // alone does not mark the tab dirty, since the modal is its own commit
  // affordance. Cleared on unmount so a stale marker can't outlive the grid.
  useEffect(() => {
    if (!activeTabId) return;
    const isDirty =
      canEditRows &&
      (pendingEdits.size > 0 ||
        pendingNewRows.length > 0 ||
        pendingDeletedRowKeys.size > 0);
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
    canEditRows,
  ]);

  // Listen for global Cmd+S commit shortcut. Only the active tab's grid
  // should react — gate on activeTabId being present and pending changes
  // existing. Otherwise the dispatch is silently ignored (idempotent).
  useEffect(() => {
    const handler = () => {
      if (!canEditRows) return;
      // Cmd+S with nothing pending → toast instead of a silent no-op (the
      // silent path was inscrutable). No flash — the toast is the feedback.
      if (!hasPendingChanges) {
        toast.info(t("noChangesToCommit"));
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
        // Issue #1081 — anchor the in-flight cell's row before committing,
        // so the override map's WHERE resolves from the captured row.
        if (merged.has(key)) {
          const row = data.rows[editingCell.row] as unknown[] | undefined;
          if (row) captureEditRowSnapshot(editingCell.row, row);
        }
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
    t,
    hasPendingChanges,
    editingCell,
    editValue,
    pendingEdits,
    data,
    handleCommit,
    beginCommitFlash,
    setPendingEdits,
    captureEditRowSnapshot,
    canEditRows,
  ]);

  return {
    editingCell,
    editValue,
    setEditValue: setEditValueWithErrorClear,
    setEditNull,
    pendingEdits,
    setPendingEdits,
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
