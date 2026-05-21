import { useEffect } from "react";

interface UseRdbDataGridShortcutsParams {
  editingCell: { row: number; col: number } | null;
  canUndo: boolean;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onCancelEdit: () => void;
  onDiscard: () => void;
  onUndo: () => void;
}

export function useRdbDataGridShortcuts({
  editingCell,
  canUndo,
  onToggleFilters,
  onToggleQuickLook,
  onCancelEdit,
  onDiscard,
  onUndo,
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
      if (
        document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
      ) {
        return;
      }
      e.preventDefault();
      onDiscard();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCell, onDiscard]);

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
}
