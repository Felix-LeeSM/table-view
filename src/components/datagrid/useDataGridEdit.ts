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
    clearPendingEntry,
    restageAfterCommit,
    pushSnapshot,
    undo,
    canUndo,
  } = useDataGridEditPendingState({
    connectionId,
    database,
    schema,
    table,
    // Issue #1081 — the pending-state layer auto-captures a row-identity
    // anchor for every new edit/delete key from the current page's rows.
    rows: data?.rows,
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

  // ADR 0048 (#1126) — commit-success cleanup differs from discard: the undo
  // stack must SURVIVE the commit. `restageAfterCommit` swaps the committed
  // pending edits for a single reversal snapshot so a post-commit Cmd+Z
  // re-stages the old values as a new pending edit (DB writes stay commit-only).
  // Everything else mirrors `clearAllPending` (drop editor / selection / errors).
  const clearPendingAfterCommit = useCallback(() => {
    restageAfterCommit();
    setPendingEditErrors(new Map());
    clearSelection();
    setEditingCell(null);
    setEditValue("");
  }, [restageAfterCommit, clearSelection]);

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
    onCommitCleanup: clearPendingAfterCommit,
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
      // Issue #1081 — the row-identity anchor is captured inside
      // `setPendingEdits` (see `useDataGridEditPendingState`).
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
          // Issue #1081 — anchor captured inside `setPendingEdits`.
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
        next.add(rowKeyFn(rowIdx, page));
      });
      return next;
    });
    // Issue #1081 — the deleted rows' identity anchors are captured inside
    // `setPendingDeletedRowKeys` from the current page's rows.
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
  // affordance.
  //
  // Issue #1204 — the marker tracks *pending edits existing*, not the grid
  // being mounted. The four pending slices live in the cross-mount
  // `dataGridEditStore` (Sprint 251), so a tab switch (which unmounts this
  // grid) must NOT clear the marker while the edits survive in the store —
  // otherwise the inactive tab's close / disconnect guard reads a stale
  // false. The marker clears through this effect when the pending diff empties
  // (commit / discard, still mounted) and through `removeTab` /
  // `clearForConnection` on explicit close.
  useEffect(() => {
    if (!activeTabId) return;
    const isDirty =
      canEditRows &&
      (pendingEdits.size > 0 ||
        pendingNewRows.length > 0 ||
        pendingDeletedRowKeys.size > 0);
    setTabDirty(activeTabId, isDirty);
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
        // Issue #1081 — anchor captured inside `setPendingEdits` before the
        // synchronous commit reads the snapshot map.
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
    t,
    hasPendingChanges,
    editingCell,
    editValue,
    pendingEdits,
    data,
    handleCommit,
    beginCommitFlash,
    setPendingEdits,
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
    // Issue #1174 — expose the edit-time row anchors so the render overlay
    // can follow a pending edit to its actual row across pagination.
    pendingEditRowSnapshots,
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
