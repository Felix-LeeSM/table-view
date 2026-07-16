import { useEffect } from "react";

interface UseRdbDataGridShortcutsParams {
  editingCell: { row: number; col: number } | null;
  canUndo: boolean;
  canRedo: boolean;
  /**
   * Pending/dirty state. Escape only opens the discard confirm when there is
   * something to discard — with nothing pending it stays a no-op, preserving
   * the prior behavior (`handleDiscard` was a no-op when nothing was pending).
   */
  hasPendingChanges: boolean;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onCancelEdit: () => void;
  /**
   * Opens the SAME confirm gate as the toolbar's Discard button (PR #1013).
   * Discarding is unrecoverable, so Escape must confirm first instead of
   * wiping pending edits immediately.
   */
  onRequestDiscard: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function useRdbDataGridShortcuts({
  editingCell,
  canUndo,
  canRedo,
  hasPendingChanges,
  onToggleFilters,
  onToggleQuickLook,
  onCancelEdit,
  onRequestDiscard,
  onUndo,
  onRedo,
}: UseRdbDataGridShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggleFilters();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onToggleFilters]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "l" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onToggleQuickLook();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onToggleQuickLook]);

  useEffect(() => {
    const handler = () => {
      onCancelEdit();
    };
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [onCancelEdit]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (editingCell !== null) return;
      // A dialog already owns Escape (including our own discard-confirm once
      // open) — don't re-open/stack the gate, let the dialog handle it.
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      ) {
        return;
      }
      // Nothing to discard → preserve prior no-op behavior, no confirm popup.
      if (!hasPendingChanges) return;
      e.preventDefault();
      onRequestDiscard();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCell, hasPendingChanges, onRequestDiscard]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !(
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "z" &&
          !e.shiftKey
        )
      ) {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!canUndo) return;
      e.preventDefault();
      onUndo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canUndo, onUndo]);

  // Issue #1527 (ADR 0050) — Cmd/Ctrl+Shift+Z redoes a pending-edit undo,
  // mirroring the Cmd+Z binding above (same input-focus deferral so the
  // browser's native redo wins inside a field). ponytail: skipped the
  // Windows Ctrl+Y alias — add if requested; ADR 0050 specifies Cmd+Shift+Z.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        !((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && e.shiftKey)
      ) {
        return;
      }
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!canRedo) return;
      e.preventDefault();
      onRedo();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canRedo, onRedo]);
}
