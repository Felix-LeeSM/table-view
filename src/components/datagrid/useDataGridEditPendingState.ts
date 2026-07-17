import { useCallback, useMemo, useRef } from "react";
import {
  useDataGridEditStore,
  entryKey as makeStoreEntryKey,
  EMPTY_ENTRY,
} from "@stores/dataGridEditStore";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";
import type {
  ConnectionId,
  DatabaseName,
  SchemaName,
  TableName,
} from "@/types/branded";
import type { AppliedPendingOps } from "@/lib/datagrid/paradigmEditAdapter";
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
    // Brand each axis once at this boundary (params arrive as plain `string`
    // from the grid); `entryKey`'s branded params then reject a positional swap.
    return makeStoreEntryKey(
      connectionId as ConnectionId,
      database as DatabaseName,
      schema as SchemaName,
      table as TableName,
    );
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
  const redoStack = entry.redoStack as UndoStack;
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
      // #1616 (B4) — an unchanged result (e.g. `applyEditOrClear` returning the
      // same Map when the edit matches the original and isn't yet pending) is a
      // no-op. Re-setting the stored reference is rejected by the store's
      // slice-replacement invariant guard, so skip it here (mirrors
      // `setRedoStack`). No new keys means the anchor capture below is a no-op too.
      if (value === prev) return;
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
      if (value === current) return; // #1616 (B4) — same-ref no-op; see setPendingEdits.
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
      if (value === prev) return; // #1616 (B4) — same-ref no-op; see setPendingEdits.
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
      if (value === current) return; // #1616 (B4) — same-ref no-op; see setPendingEdits.
      storeSetSlice(storeKey, "undoStack", value);
    },
    [storeKey, storeSetSlice],
  );

  // Issue #1527 (ADR 0050) — the redo stack's setter. Mirrors `setUndoStack`
  // but no-ops on an identical value so `pushSnapshot`'s clear-on-edit doesn't
  // churn the store on the common (empty redo stack) path.
  const setRedoStack = useCallback(
    (next: UndoStack | ((prev: StoredUndoStack) => StoredUndoStack)) => {
      const current = useDataGridEditStore
        .getState()
        .getEntry(storeKey).redoStack;
      const value = typeof next === "function" ? next(current) : next;
      if (value === current) return;
      storeSetSlice(storeKey, "redoStack", value);
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

  // Issue #1440 — Mongo bulk commits are ordered but non-transactional: on a
  // partial failure the ops BEFORE the failed one are already applied on the
  // server. Drop exactly those entries from the pending slices so a re-commit
  // (in-modal retry or a regenerated preview) cannot duplicate them. Inserts
  // are matched by row identity (PR #1483 review B1) — the applied `newRows`
  // are the very references still sitting in `pendingNewRows`, so the prune
  // stays exact across the same session's 2nd+ partial failure.
  // ponytail: row-anchor snapshot entries for pruned keys stay behind — they
  // are keyed lookups and unused keys are ignored; prune them if the snapshot
  // maps ever grow visible semantics.
  const prunePartiallyCommitted = useCallback(
    (applied: AppliedPendingOps) => {
      if (applied.editKeys.length > 0) {
        setPendingEdits((prev) => {
          const next = new Map(prev);
          for (const key of applied.editKeys) next.delete(key);
          return next;
        });
      }
      if (applied.deleteKeys.length > 0) {
        setPendingDeletedRowKeys((prev) => {
          const next = new Set(prev);
          for (const key of applied.deleteKeys) next.delete(key);
          return next;
        });
      }
      if (applied.newRows.length > 0) {
        const drop = new Set<unknown>(applied.newRows);
        setPendingNewRows((prev) => prev.filter((row) => !drop.has(row)));
      }
      // PR #1483 review B2 — every snapshot pushed BEFORE this prune still
      // contains the applied ops; restoring one via undo would re-stage an
      // op the server already executed (duplicate write on re-commit).
      // Snapshot new-rows are deep copies, so identity-pruning the stack is
      // impossible for inserts — invalidate the whole stack instead.
      // ponytail: full-stack invalidation; per-snapshot pruning needs a
      // stable insert identity (row token) if undo retention after a partial
      // failure ever matters.
      setUndoStack([]);
      // Issue #1527 — the redo stack holds pre-undo states that likewise
      // predate this prune, so redoing one would re-stage an already-applied
      // op (duplicate write on re-commit). Invalidate it in lockstep.
      setRedoStack([]);
    },
    [
      setPendingEdits,
      setPendingDeletedRowKeys,
      setPendingNewRows,
      setUndoStack,
      setRedoStack,
    ],
  );

  // #1444 — structural sharing (ADR 0050 redo substrate). The five pending
  // slices are immutable: every setter (`setPendingEdits` etc. and the store's
  // `setSlice`) REPLACES the whole slice with a freshly-allocated Map/Set/Array
  // and never mutates one in place, and new-row cells render read-only. So the
  // undo snapshot retains the CURRENT slice references instead of deep-cloning
  // them each edit. This drops `pushSnapshot` from O(pending size) to O(1) — N
  // edits go from O(N^2) to O(N) clone work — and lets consecutive snapshots
  // share the slices a mutation left untouched (a pure-edit run keeps ONE
  // `pendingNewRows`/`pendingDeletedRowKeys` reference across all 50 levels
  // instead of 50 redundant clones). `undo()` still copies out of the snapshot
  // (rare, one action), so the restored live state stays isolated from the
  // retained history. Redo (ADR 0050, #1126) layers on unchanged: each entry is
  // already a full pre-mutation state, so a symmetric `redoStack` just captures
  // the current state before an undo restores.
  const pushSnapshot = useCallback(() => {
    setUndoStack((prev) => {
      const snap: EditSnapshot = {
        pendingEdits,
        pendingNewRows,
        pendingDeletedRowKeys,
        // Issue #1081 — anchors ride along so undo restores them too.
        pendingEditRowSnapshots,
        pendingDeletedRowSnapshots,
      };
      const next = [...prev, snap];
      if (next.length > UNDO_STACK_MAX) next.shift();
      return next;
    });
    // Issue #1527 (ADR 0050) — a new edit invalidates the redo stack (standard
    // undo/redo semantics). Guard the common empty case so a pure-edit run
    // doesn't churn the store on every keystroke.
    if (
      useDataGridEditStore.getState().getEntry(storeKey).redoStack.length > 0
    ) {
      setRedoStack([]);
    }
  }, [
    storeKey,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    pendingEditRowSnapshots,
    pendingDeletedRowSnapshots,
    setUndoStack,
    setRedoStack,
  ]);

  // Issue #1527 (ADR 0050) — restore a captured snapshot into the five live
  // pending slices. Shared by `undo` (from `undoStack`) and `redo` (from
  // `redoStack`); each setter copies out so the retained history stays
  // isolated from the live state (matches the original `undo` behavior).
  const restoreSnapshot = useCallback(
    (snap: EditSnapshot) => {
      setPendingEdits(new Map(snap.pendingEdits));
      setPendingNewRows(snap.pendingNewRows.map((row) => [...row]));
      setPendingDeletedRowKeys(new Set(snap.pendingDeletedRowKeys));
      // Issue #1081 — restore the row-identity anchors in lockstep.
      setPendingEditRowSnapshots(new Map(snap.pendingEditRowSnapshots));
      setPendingDeletedRowSnapshots(new Map(snap.pendingDeletedRowSnapshots));
    },
    [
      setPendingEdits,
      setPendingNewRows,
      setPendingDeletedRowKeys,
      setPendingEditRowSnapshots,
      setPendingDeletedRowSnapshots,
    ],
  );

  const undo = useCallback(() => {
    const current = useDataGridEditStore.getState().getEntry(storeKey);
    const stack = current.undoStack;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1]!;
    const rest = stack.slice(0, -1);
    // #1126 — a post-commit snapshot flagged `restageBlocked` covered a commit
    // whose INSERT/DELETE can't be reproduced (auto-increment PK / missing row
    // snapshot); drop it and tell the user instead of a silent no-op. No state
    // changes, so nothing is pushed onto the redo stack.
    if (last.restageBlocked) {
      setUndoStack(rest);
      toast.info(i18n.t("datagrid:undoRestageBlocked"));
      return;
    }
    // Issue #1527 — capture the pre-undo state so `redo()` can return to it.
    // The five slices are immutable (structural sharing, #1444), so retaining
    // the current references is safe without cloning.
    setRedoStack((prev) => {
      const snap: EditSnapshot = {
        pendingEdits: current.pendingEdits,
        pendingNewRows: current.pendingNewRows,
        pendingDeletedRowKeys: current.pendingDeletedRowKeys,
        pendingEditRowSnapshots: current.pendingEditRowSnapshots,
        pendingDeletedRowSnapshots: current.pendingDeletedRowSnapshots,
      };
      const next = [...prev, snap];
      if (next.length > UNDO_STACK_MAX) next.shift();
      return next;
    });
    restoreSnapshot(last);
    setUndoStack(rest);
  }, [storeKey, setUndoStack, setRedoStack, restoreSnapshot]);

  // Issue #1527 (ADR 0050) — the mirror of `undo`: pop `redoStack`, push the
  // pre-redo state onto `undoStack` (so the redo is itself undoable), and
  // restore the snapshot. Redo entries are always real states pushed by
  // `undo`, never a `restageBlocked` marker, so no blocked-branch handling.
  const redo = useCallback(() => {
    const current = useDataGridEditStore.getState().getEntry(storeKey);
    const stack = current.redoStack;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1]!;
    const rest = stack.slice(0, -1);
    setUndoStack((prev) => {
      const snap: EditSnapshot = {
        pendingEdits: current.pendingEdits,
        pendingNewRows: current.pendingNewRows,
        pendingDeletedRowKeys: current.pendingDeletedRowKeys,
        pendingEditRowSnapshots: current.pendingEditRowSnapshots,
        pendingDeletedRowSnapshots: current.pendingDeletedRowSnapshots,
      };
      const next = [...prev, snap];
      if (next.length > UNDO_STACK_MAX) next.shift();
      return next;
    });
    restoreSnapshot(last);
    setRedoStack(rest);
  }, [storeKey, setUndoStack, setRedoStack, restoreSnapshot]);

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
    prunePartiallyCommitted,
    pushSnapshot,
    undo,
    canUndo: undoStack.length > 0,
    redo,
    canRedo: redoStack.length > 0,
  };
}
