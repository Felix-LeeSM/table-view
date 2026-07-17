/**
 * Sprint 251 — In-memory store for the four DataGrid pending-edit slices.
 *
 * Lifts `pendingEdits` / `pendingNewRows` / `pendingDeletedRowKeys` /
 * `undoStack` out of `useDataGridEdit`'s `useState` so a tab switch
 * (which unmounts the grid component tree) no longer discards the user's
 * in-flight work. The next mount of the SAME
 * `(connectionId, database, schema, table)` key re-binds to the same
 * entry; a different key starts empty.
 *
 * Lifecycle:
 * - `getEntry(key)` returns the entry for `key` if present, otherwise the
 *   shared `EMPTY_ENTRY` constant. Callers must NEVER mutate the returned
 *   value — `setSlice` / `clearEntry` always replace the slice with a
 *   freshly-allocated Map / Set / Array so React selector equality detects
 *   the change.
 * - `setSlice(key, slice, value)` updates exactly one slice on `key`,
 *   leaving the other three intact. Lazily creates the entry from
 *   `EMPTY_ENTRY` if missing.
 * - `clearEntry(key)` resets all four slices on `key` to empty (used by
 *   `clearAllPending` after a successful commit / explicit discard).
 * - `purgeKey(key)` removes the entry from the map entirely (used by
 *   `tabStore.removeTab` when the closing tab was the last consumer of
 *   that key).
 * - `purgeForConnection(connectionId)` deletes every entry whose key
 *   starts with `${connectionId}::` (used by
 *   `tabStore.clearTabsForConnection` when a connection is dropped).
 *
 * Out of scope for Sprint 251 (intentional):
 * - localStorage persistence — the entry buffer is window-local.
 * - Cross-window broadcast — pending state is per-workspace, not synced.
 * - Mongo grid (read-only paradigm) reads but never writes pending state;
 *   keeping it on the store is harmless (entry stays empty).
 */
import { create } from "zustand";
import type {
  ConnectionId,
  DatabaseName,
  SchemaName,
  TableName,
} from "@/types/branded";

/**
 * Snapshot of the three diff slices captured BEFORE a mutating handler
 * runs (Sprint 249, ADR 0022 Phase 5). Stored on `undoStack`. Must mirror
 * the type that lives in `useDataGridEdit.ts` exactly — re-exported here
 * so the store interface stays self-contained without a circular import.
 */
export interface EditSnapshot {
  pendingEdits: ReadonlyMap<string, string | null>;
  pendingNewRows: ReadonlyArray<ReadonlyArray<unknown>>;
  pendingDeletedRowKeys: ReadonlySet<string>;
  // Issue #1081 — undo must restore the row-identity anchors too, else an
  // orphan snapshot outlives the pending edit/delete it anchored.
  pendingEditRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
  pendingDeletedRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
  // #1126 (ADR 0048) — marks a post-commit snapshot whose committed
  // INSERT/DELETE can't be reproduced (auto-increment PK / missing row
  // snapshot) as non-restageable. Mirrors the type in `dataGridEditFsm.ts`.
  restageBlocked?: boolean;
}

export interface PendingEntry {
  pendingEdits: ReadonlyMap<string, string | null>;
  pendingNewRows: ReadonlyArray<ReadonlyArray<unknown>>;
  pendingDeletedRowKeys: ReadonlySet<string>;
  undoStack: ReadonlyArray<EditSnapshot>;
  // Issue #1527 (ADR 0050) — the symmetric redo stack. Lifecycle (all in
  // `useDataGridEditPendingState`):
  //   populate: `undo()` pushes the pre-undo state here before restoring.
  //   consume:  `redo()` pops the top back and re-pushes it onto `undoStack`.
  //   clear:    (a) `pushSnapshot` on any NEW edit (standard redo invalidation),
  //             (b) `prunePartiallyCommitted` after a partial-commit prune,
  //             (c) `clearEntry` on post-commit / discard.
  // Pending-edit symmetry only — commit-span redo survival (ADR 0050 point 1)
  // stays deferred to #1126, which is why (c) wipes it rather than restaging.
  redoStack: ReadonlyArray<EditSnapshot>;
  /**
   * Issue #1081 — row-identity anchors captured at edit/delete time so a
   * commit builds its WHERE / `_id` from the row the user actually touched,
   * not from whatever `data.rows[rowIdx]` holds after the grid re-orders
   * (pagination, sort change, refetch).
   *
   * - `pendingEditRowSnapshots` keyed by the CELL key `${rowIdx}-${colIdx}`
   *   — the SAME collision domain as `pendingEdits`, so a cross-page edit on
   *   the same visual row index but a different column keeps its own anchor
   *   instead of clobbering the earlier one (a wrong-row-write path when the
   *   snapshot was coarser than the edit key).
   * - `pendingDeletedRowSnapshots` keyed by the full delete key
   *   (`row-${page}-${rowIdx}`) — delete keys are page-distinct, so their
   *   snapshots must be too.
   *
   * Values are shallow copies of the row's cells.
   */
  pendingEditRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
  pendingDeletedRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
}

type MutablePendingEntry = {
  pendingEdits: Map<string, string | null>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  undoStack: EditSnapshot[];
  redoStack: EditSnapshot[];
  pendingEditRowSnapshots: Map<string, ReadonlyArray<unknown>>;
  pendingDeletedRowSnapshots: Map<string, ReadonlyArray<unknown>>;
};

/**
 * Shared default entry. `getEntry(key)` returns this *exact* reference
 * for any missing key so React selectors that compare by reference
 * don't see a fresh object every render. The nested containers are
 * hardened too: Map/Set mutators throw and arrays are frozen. Every write
 * goes through `setSlice` / `clearEntry`, both of which allocate fresh
 * Map / Set / Array values.
 */
function throwReadOnlyMutation(label: string): never {
  throw new TypeError(
    `${label} belongs to EMPTY_ENTRY and cannot be mutated directly`,
  );
}

function readonlyEmptyMap<K, V>(label: string): ReadonlyMap<K, V> {
  return new Proxy(new Map<K, V>(), {
    get(target, property) {
      if (property === "set" || property === "delete" || property === "clear") {
        return () => throwReadOnlyMutation(label);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function readonlyEmptySet<T>(label: string): ReadonlySet<T> {
  return new Proxy(new Set<T>(), {
    get(target, property) {
      if (property === "add" || property === "delete" || property === "clear") {
        return () => throwReadOnlyMutation(label);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export const EMPTY_ENTRY: PendingEntry = Object.freeze({
  pendingEdits: readonlyEmptyMap<string, string | null>(
    "EMPTY_ENTRY.pendingEdits",
  ),
  pendingNewRows: Object.freeze([]) as ReadonlyArray<ReadonlyArray<unknown>>,
  pendingDeletedRowKeys: readonlyEmptySet<string>(
    "EMPTY_ENTRY.pendingDeletedRowKeys",
  ),
  undoStack: Object.freeze([]) as ReadonlyArray<EditSnapshot>,
  redoStack: Object.freeze([]) as ReadonlyArray<EditSnapshot>,
  pendingEditRowSnapshots: readonlyEmptyMap<string, ReadonlyArray<unknown>>(
    "EMPTY_ENTRY.pendingEditRowSnapshots",
  ),
  pendingDeletedRowSnapshots: readonlyEmptyMap<string, ReadonlyArray<unknown>>(
    "EMPTY_ENTRY.pendingDeletedRowSnapshots",
  ),
});

export interface DataGridEditStore {
  entries: ReadonlyMap<string, PendingEntry>;
  /**
   * Read the entry for `key`, returning the shared {@link EMPTY_ENTRY}
   * when absent. Reference equality on the empty default is intentional
   * so unmounted grids on a key that never had pending work don't
   * trigger spurious re-renders.
   */
  getEntry: (key: string) => PendingEntry;
  /**
   * Replace exactly one slice on `key`. Other slices are preserved (read
   * from the existing entry, or `EMPTY_ENTRY` when missing). Always
   * allocates a new entries Map so subscribers detect the change.
   */
  setSlice: <K extends keyof PendingEntry>(
    key: string,
    slice: K,
    value: PendingEntry[K],
  ) => void;
  /**
   * Reset every slice on `key` to empty. The entry is replaced with a
   * fresh `PendingEntry` (NOT the frozen default) so subsequent
   * `setSlice` calls don't accidentally try to mutate `EMPTY_ENTRY`.
   */
  clearEntry: (key: string) => void;
  /**
   * #1364 — does any entry keyed under `keyPrefix` hold real pending content?
   * Owns the table-grid dirty predicate (edits / new rows / deletes) so
   * whole-connection close gates route through the store instead of
   * re-deriving it. Reactive: called from a store selector, so a slice write
   * flips the result.
   */
  hasDirtyEntries: (keyPrefix: string) => boolean;
  /** Remove the entry for `key` entirely. */
  purgeKey: (key: string) => void;
  /**
   * Remove every entry whose key starts with `${connectionId}::`. Used
   * when a connection is dropped wholesale.
   */
  purgeForConnection: (connectionId: string) => void;
}

/**
 * Compose the canonical entry key. Centralised so `tabStore` and
 * `useDataGridEdit` agree on the shape verbatim.
 *
 * Issue #1494 — the four axes are branded so a positional swap (most often
 * schema/table, whose values are interchangeable `string`s) is a compile
 * error instead of a silent cross-table pending-edit miskey.
 */
export function entryKey(
  connectionId: ConnectionId,
  database: DatabaseName,
  schema: SchemaName,
  table: TableName,
): string {
  return `${connectionId}::${database}::${schema}::${table}`;
}

/**
 * Boundary helper (issue #1621 G1) — brand the four plain-string axes (they
 * arrive as `string` off grid props / DOM events) and compose the entry key in
 * ONE place, replacing four consecutive `as` casts at each call site. Named
 * fields keep the positional-swap protection `entryKey`'s branded params give
 * (issue #1494): you can't line up schema/table wrong when they're keyed.
 */
export function entryKeyFromStrings(axes: {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}): string {
  return entryKey(
    axes.connectionId as ConnectionId,
    axes.database as DatabaseName,
    axes.schema as SchemaName,
    axes.table as TableName,
  );
}

/** Build a fresh empty entry — used by `clearEntry` so the entry is not the frozen default. */
function freshEntry(): MutablePendingEntry {
  return {
    pendingEdits: new Map(),
    pendingNewRows: [],
    pendingDeletedRowKeys: new Set(),
    undoStack: [],
    redoStack: [],
    pendingEditRowSnapshots: new Map(),
    pendingDeletedRowSnapshots: new Map(),
  };
}

export const useDataGridEditStore = create<DataGridEditStore>((set, get) => ({
  entries: new Map<string, PendingEntry>(),

  getEntry: (key) => {
    const entry = get().entries.get(key);
    return entry ?? EMPTY_ENTRY;
  },

  hasDirtyEntries: (keyPrefix) => {
    for (const [key, entry] of get().entries) {
      if (!key.startsWith(keyPrefix)) continue;
      if (
        entry.pendingEdits.size > 0 ||
        entry.pendingNewRows.length > 0 ||
        entry.pendingDeletedRowKeys.size > 0
      ) {
        return true;
      }
    }
    return false;
  },

  setSlice: (key, slice, value) => {
    // #1616 (B4, PR #1503) — "slice 통째 교체만 허용" invariant. The undo/redo
    // snapshots retain the live slice references (structural sharing, #1444),
    // so a slice MUST be replaced with a freshly-allocated Map/Set/Array, never
    // mutated in place. Receiving back the reference already stored means a
    // caller mutated it in place and re-set it — that silently corrupts every
    // snapshot sharing it AND the reference-compare selectors miss the change.
    // Reject instead of writing the poisoned reference.
    const current = get().entries.get(key);
    if (current && current[slice] === value) {
      throw new TypeError(
        `setSlice(${String(slice)}) received the slice reference already stored; ` +
          `slices must be replaced with a fresh Map/Set/Array, not mutated in place`,
      );
    }
    set((state) => {
      const existing = state.entries.get(key);
      // Lazy entry construction: missing key → start from a fresh entry
      // (NOT the frozen default — we need to mutate one slice on it).
      const base: PendingEntry = existing ?? freshEntry();
      const nextEntry: PendingEntry = { ...base, [slice]: value };
      const nextEntries = new Map(state.entries);
      nextEntries.set(key, nextEntry);
      return { entries: nextEntries };
    });
  },

  clearEntry: (key) =>
    set((state) => {
      // Replace with a fresh entry rather than deleting the key — the
      // semantics of `clearAllPending` in the hook is "reset all four
      // slices to empty", not "purge". The entry stays addressable so
      // a subsequent `setSlice` doesn't have to re-create it.
      const nextEntries = new Map(state.entries);
      nextEntries.set(key, freshEntry());
      return { entries: nextEntries };
    }),

  purgeKey: (key) =>
    set((state) => {
      if (!state.entries.has(key)) return state;
      const nextEntries = new Map(state.entries);
      nextEntries.delete(key);
      return { entries: nextEntries };
    }),

  purgeForConnection: (connectionId) =>
    set((state) => {
      const prefix = `${connectionId}::`;
      let mutated = false;
      const nextEntries = new Map(state.entries);
      for (const key of state.entries.keys()) {
        if (key.startsWith(prefix)) {
          nextEntries.delete(key);
          mutated = true;
        }
      }
      // Identity short-circuit: no matching keys → keep the existing Map
      // so subscribers don't re-render when the call is a no-op.
      if (!mutated) return state;
      return { entries: nextEntries };
    }),
}));
