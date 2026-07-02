import { useCallback, useMemo, useRef } from "react";
import {
  useDataGridEditStore,
  entryKey as makeStoreEntryKey,
  EMPTY_ENTRY,
} from "@stores/dataGridEditStore";
import { UNDO_STACK_MAX, type EditSnapshot } from "./dataGridEditFsm";

type PendingEdits = Map<string, string | null>;
type PendingNewRows = unknown[][];
type PendingDeletedRowKeys = Set<string>;
type UndoStack = EditSnapshot[];
type StoredPendingNewRows = ReadonlyArray<ReadonlyArray<unknown>>;
type StoredUndoStack = ReadonlyArray<EditSnapshot>;

interface UseDataGridEditPendingStateParams {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
  /**
   * Issue #1081 — the current page's rows. Used by the `setPendingEdits` /
   * `setPendingDeletedRowKeys` wrappers to auto-capture a row-identity anchor
   * for any NEW pending key, so EVERY caller anchors — including the nested
   * JSON-tree panels that call `setPendingEdits` directly, bypassing
   * `useDataGridEdit`.
   */
  rows?: unknown[][];
}

export function useDataGridEditPendingState({
  connectionId,
  database,
  schema,
  table,
  rows,
}: UseDataGridEditPendingStateParams) {
  const fallbackInstanceKeyRef = useRef<string | null>(null);
  if (fallbackInstanceKeyRef.current === null) {
    fallbackInstanceKeyRef.current = `__instance__::${Math.random().toString(36).slice(2)}::${Date.now()}`;
  }

  // Keep the latest rows in a ref so the memoised setters read the current
  // page without re-creating on every data change.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const storeKey = useMemo(() => {
    if (!connectionId || !database || !schema || !table) {
      return fallbackInstanceKeyRef.current!;
    }
    return makeStoreEntryKey(connectionId, database, schema, table);
  }, [connectionId, database, schema, table]);

  const entry =
    useDataGridEditStore((s) => s.entries.get(storeKey)) ?? EMPTY_ENTRY;
  // Keep the Sprint 251 hook surface stable for component callers; the
  // store boundary is readonly and EMPTY_ENTRY mutators are runtime-guarded.
  const pendingEdits = entry.pendingEdits as PendingEdits;
  const pendingNewRows = entry.pendingNewRows as PendingNewRows;
  const pendingDeletedRowKeys =
    entry.pendingDeletedRowKeys as PendingDeletedRowKeys;
  const undoStack = entry.undoStack as UndoStack;
  // Issue #1081 — row-identity anchors so a page/sort/refetch reorder can't
  // point a pending edit/delete at the wrong row on commit.
  const pendingEditRowSnapshots = entry.pendingEditRowSnapshots;
  const pendingDeletedRowSnapshots = entry.pendingDeletedRowSnapshots;

  const storeSetSlice = useDataGridEditStore((s) => s.setSlice);
  const storeClearEntry = useDataGridEditStore((s) => s.clearEntry);

  const setPendingEdits = useCallback(
    (
      next:
        | PendingEdits
        | ((prev: ReadonlyMap<string, string | null>) => PendingEdits),
    ) => {
      const state = useDataGridEditStore.getState();
      const prev = state.getEntry(storeKey).pendingEdits;
      const value = typeof next === "function" ? next(prev) : next;
      // Issue #1081 — anchor any NEW edit key (top-level `${rowIdx}-${colIdx}`
      // OR nested `${rowIdx}-${colIdx}:${path}`) to its row's identity, keyed
      // by the base CELL key. Runs for EVERY setPendingEdits caller, so the
      // nested tree panels anchor without per-call-site capture. Existing
      // keys keep their first-edit anchor (matches `pendingEdits`, which is
      // the sole entry for a given cell key).
      const rows = rowsRef.current;
      if (rows) {
        const snaps = state.getEntry(storeKey).pendingEditRowSnapshots;
        let nextSnaps: Map<string, ReadonlyArray<unknown>> | null = null;
        for (const key of value.keys()) {
          if (prev.has(key)) continue;
          const baseKey = key.split(":")[0]!;
          if (snaps.has(baseKey) || nextSnaps?.has(baseKey)) continue;
          const rowIdx = Number.parseInt(baseKey.split("-")[0]!, 10);
          const row = rows[rowIdx] as readonly unknown[] | undefined;
          if (!row) continue;
          nextSnaps ??= new Map(snaps);
          nextSnaps.set(baseKey, [...row]);
        }
        if (nextSnaps) {
          storeSetSlice(storeKey, "pendingEditRowSnapshots", nextSnaps);
        }
      }
      storeSetSlice(storeKey, "pendingEdits", value);
    },
    [storeKey, storeSetSlice],
  );

  const setPendingNewRows = useCallback(
    (
      next:
        | PendingNewRows
        | ((prev: StoredPendingNewRows) => StoredPendingNewRows),
    ) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).pendingNewRows;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "pendingNewRows", value);
    },
    [storeKey, storeSetSlice],
  );

  const setPendingDeletedRowKeys = useCallback(
    (
      next:
        | PendingDeletedRowKeys
        | ((prev: ReadonlySet<string>) => PendingDeletedRowKeys),
    ) => {
      const state = useDataGridEditStore.getState();
      const prev = state.getEntry(storeKey).pendingDeletedRowKeys;
      const value = typeof next === "function" ? next(prev) : next;
      // Issue #1081 — anchor any NEW delete key (`row-${page}-${rowIdx}`) to
      // its row's identity, keyed by the full page-distinct delete key.
      const rows = rowsRef.current;
      if (rows) {
        const snaps = state.getEntry(storeKey).pendingDeletedRowSnapshots;
        let nextSnaps: Map<string, ReadonlyArray<unknown>> | null = null;
        for (const delKey of value) {
          if (prev.has(delKey) || snaps.has(delKey) || nextSnaps?.has(delKey)) {
            continue;
          }
          const rowIdx = Number.parseInt(delKey.split("-")[2]!, 10);
          const row = rows[rowIdx] as readonly unknown[] | undefined;
          if (!row) continue;
          nextSnaps ??= new Map(snaps);
          nextSnaps.set(delKey, [...row]);
        }
        if (nextSnaps) {
          storeSetSlice(storeKey, "pendingDeletedRowSnapshots", nextSnaps);
        }
      }
      storeSetSlice(storeKey, "pendingDeletedRowKeys", value);
    },
    [storeKey, storeSetSlice],
  );

  const setUndoStack = useCallback(
    (next: UndoStack | ((prev: StoredUndoStack) => StoredUndoStack)) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).undoStack;
      const value = typeof next === "function" ? next(current) : next;
      storeSetSlice(storeKey, "undoStack", value);
    },
    [storeKey, storeSetSlice],
  );

  const setPendingEditRowSnapshots = useCallback(
    (value: Map<string, ReadonlyArray<unknown>>) => {
      storeSetSlice(storeKey, "pendingEditRowSnapshots", value);
    },
    [storeKey, storeSetSlice],
  );

  const setPendingDeletedRowSnapshots = useCallback(
    (value: Map<string, ReadonlyArray<unknown>>) => {
      storeSetSlice(storeKey, "pendingDeletedRowSnapshots", value);
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
        // Issue #1081 — snapshot the anchors so undo restores them too.
        pendingEditRowSnapshots: new Map(pendingEditRowSnapshots),
        pendingDeletedRowSnapshots: new Map(pendingDeletedRowSnapshots),
      };
      const next = [...prev, snap];
      if (next.length > UNDO_STACK_MAX) next.shift();
      return next;
    });
  }, [
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    pendingEditRowSnapshots,
    pendingDeletedRowSnapshots,
    setUndoStack,
  ]);

  const undo = useCallback(() => {
    setUndoStack((prevStack) => {
      if (prevStack.length === 0) return prevStack;
      const last = prevStack[prevStack.length - 1]!;
      setPendingEdits(new Map(last.pendingEdits));
      setPendingNewRows(last.pendingNewRows.map((row) => [...row]));
      setPendingDeletedRowKeys(new Set(last.pendingDeletedRowKeys));
      // Issue #1081 — restore the row-identity anchors in lockstep.
      setPendingEditRowSnapshots(new Map(last.pendingEditRowSnapshots));
      setPendingDeletedRowSnapshots(new Map(last.pendingDeletedRowSnapshots));
      return prevStack.slice(0, -1);
    });
  }, [
    setPendingEdits,
    setPendingNewRows,
    setPendingDeletedRowKeys,
    setPendingEditRowSnapshots,
    setPendingDeletedRowSnapshots,
    setUndoStack,
  ]);

  return {
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    pendingEditRowSnapshots,
    pendingDeletedRowSnapshots,
    setPendingEdits,
    setPendingNewRows,
    setPendingDeletedRowKeys,
    clearPendingEntry,
    pushSnapshot,
    undo,
    canUndo: undoStack.length > 0,
  };
}
