import { useCallback, useMemo, useRef } from "react";
import {
  useDataGridEditStore,
  entryKey as makeStoreEntryKey,
  EMPTY_ENTRY,
} from "@stores/dataGridEditStore";
import { UNDO_STACK_MAX, type EditSnapshot } from "./dataGridEditFsm";

interface UseDataGridEditPendingStateParams {
  connectionId: string;
  schema: string;
  table: string;
}

export function useDataGridEditPendingState({
  connectionId,
  schema,
  table,
}: UseDataGridEditPendingStateParams) {
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

  const entry =
    useDataGridEditStore((s) => s.entries.get(storeKey)) ?? EMPTY_ENTRY;
  const pendingEdits = entry.pendingEdits;
  const pendingNewRows = entry.pendingNewRows;
  const pendingDeletedRowKeys = entry.pendingDeletedRowKeys;
  const undoStack = entry.undoStack;

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

  const clearPendingEntry = useCallback(() => {
    storeClearEntry(storeKey);
  }, [storeKey, storeClearEntry]);

  const pushSnapshot = useCallback(() => {
    setUndoStack((prev) => {
      const snap: EditSnapshot = {
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

  return {
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    setPendingEdits,
    setPendingNewRows,
    setPendingDeletedRowKeys,
    clearPendingEntry,
    pushSnapshot,
    undo,
    canUndo: undoStack.length > 0,
  };
}
