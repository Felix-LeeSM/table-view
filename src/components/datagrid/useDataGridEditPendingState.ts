import { useCallback, useMemo, useRef } from "react";
import {
  useDataGridEditStore,
  entryKey as makeStoreEntryKey,
  EMPTY_ENTRY,
} from "@stores/dataGridEditStore";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";
import {
  UNDO_STACK_MAX,
  buildRestageSnapshot,
  type EditSnapshot,
} from "./dataGridEditFsm";

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

  // #1126 Phase 1 (ADR 0048) — on commit success the undo stack must SURVIVE.
  // Collapse the just-committed pending edits into one reversal snapshot so a
  // post-commit Cmd+Z re-stages the pre-commit values as a new pending edit;
  // clear the pending slices but replace the stack with that snapshot (or
  // leave it empty when there was nothing restageable). Reads the current
  // store entry BEFORE clearing so the committed edits + row anchors are still
  // present.
  const restageAfterCommit = useCallback(
    (columns?: ReadonlyArray<{ is_primary_key: boolean }>) => {
      const current = useDataGridEditStore.getState().getEntry(storeKey);
      // #1126 Phase 2 — columns let `buildRestageSnapshot` verify an INSERT
      // is reversible (PK reproducible) before staging a reverse DELETE.
      const restage = buildRestageSnapshot(current, columns);
      storeClearEntry(storeKey);
      if (restage) {
        storeSetSlice(storeKey, "undoStack", [restage]);
      }
    },
    [storeKey, storeClearEntry, storeSetSlice],
  );

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
    const stack = useDataGridEditStore.getState().getEntry(storeKey).undoStack;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1]!;
    const rest = stack.slice(0, -1);
    // #1126 — a post-commit snapshot flagged `restageBlocked` covered a commit
    // whose INSERT/DELETE can't be reproduced (auto-increment PK / missing row
    // snapshot); drop it and tell the user instead of a silent no-op.
    if (last.restageBlocked) {
      setUndoStack(rest);
      toast.info(i18n.t("datagrid:undoRestageBlocked"));
      return;
    }
    setPendingEdits(new Map(last.pendingEdits));
    setPendingNewRows(last.pendingNewRows.map((row) => [...row]));
    setPendingDeletedRowKeys(new Set(last.pendingDeletedRowKeys));
    // Issue #1081 — restore the row-identity anchors in lockstep.
    setPendingEditRowSnapshots(new Map(last.pendingEditRowSnapshots));
    setPendingDeletedRowSnapshots(new Map(last.pendingDeletedRowSnapshots));
    setUndoStack(rest);
  }, [
    storeKey,
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
    restageAfterCommit,
    pushSnapshot,
    undo,
    canUndo: undoStack.length > 0,
  };
}
