/**
 * Issue #1102 — in-memory cross-mount store for the raw-query result grid's
 * two pending slices (`pendingEdits` / `pendingDeletedRowKeys`).
 *
 * `MainArea` mounts only the active tab (`key={activeTab.id}`), so keeping
 * these slices in the grid component's `useState` discarded every in-flight
 * edit the moment the user switched tabs. Lifting them here — keyed by
 * `(connectionId, tabId)` — mirrors `dataGridEditStore`'s cross-mount
 * contract for the structured table grid, so both grids now survive a tab
 * switch under the SAME preservation rule.
 *
 * Deliberately minimal vs `dataGridEditStore`: the raw grid has no INSERT
 * (`pendingNewRows`), no undo stack, and no Issue #1081 row-identity anchors,
 * so those slices are omitted rather than carried along unused.
 *
 * Lifecycle:
 * - `getEntry(key)` returns the entry for `key`, or the shared
 *   {@link EMPTY_RAW_ENTRY} when absent. Callers must NEVER mutate the
 *   returned value — every writer allocates a fresh Map / Set so React
 *   selector equality detects the change.
 * - `setSlice(key, slice, value)` replaces exactly one slice on `key`.
 * - `purgeKey(key)` removes the entry entirely (commit / discard / tab
 *   close via `tabStore.removeTab`).
 * - `purgeForConnection(connectionId)` removes every `${connectionId}::*`
 *   entry (connection dropped via `cleanupConnectionFrontendState`).
 */
import { create } from "zustand";
import type { ConnectionId, TabId } from "@/types/branded";

export interface RawPendingEntry {
  pendingEdits: ReadonlyMap<string, string>;
  pendingDeletedRowKeys: ReadonlySet<string>;
}

/**
 * Shared default entry returned for any missing key. Reference-stable so
 * unmounted grids on a key that never had pending work don't churn React
 * selectors. ponytail: no Proxy hardening (unlike `dataGridEditStore`) —
 * every writer here allocates a fresh Map / Set, so the shared empty
 * containers are never mutated in place.
 */
export const EMPTY_RAW_ENTRY: RawPendingEntry = Object.freeze({
  pendingEdits: new Map<string, string>(),
  pendingDeletedRowKeys: new Set<string>(),
});

/** Compose the canonical entry key. Centralised so producers and the
 *  `tabStore` purge path agree on the shape verbatim. */
export function rawEntryKey(connectionId: ConnectionId, tabId: TabId): string {
  return `${connectionId}::${tabId}`;
}

export interface RawQueryGridEditStore {
  entries: ReadonlyMap<string, RawPendingEntry>;
  getEntry: (key: string) => RawPendingEntry;
  setSlice: <K extends keyof RawPendingEntry>(
    key: string,
    slice: K,
    value: RawPendingEntry[K],
  ) => void;
  /**
   * #1364 — does any entry keyed under `keyPrefix` hold real pending content?
   * Owns the raw-grid dirty predicate (edits / deletes — no INSERT slice) so
   * whole-connection close gates call it instead of re-deriving it.
   */
  hasDirtyEntries: (keyPrefix: string) => boolean;
  purgeKey: (key: string) => void;
  purgeForConnection: (connectionId: string) => void;
}

export const useRawQueryGridEditStore = create<RawQueryGridEditStore>(
  (set, get) => ({
    entries: new Map<string, RawPendingEntry>(),

    getEntry: (key) => get().entries.get(key) ?? EMPTY_RAW_ENTRY,

    hasDirtyEntries: (keyPrefix) => {
      for (const [key, entry] of get().entries) {
        if (!key.startsWith(keyPrefix)) continue;
        if (
          entry.pendingEdits.size > 0 ||
          entry.pendingDeletedRowKeys.size > 0
        ) {
          return true;
        }
      }
      return false;
    },

    setSlice: (key, slice, value) =>
      set((state) => {
        const base = state.entries.get(key) ?? EMPTY_RAW_ENTRY;
        const nextEntries = new Map(state.entries);
        nextEntries.set(key, { ...base, [slice]: value });
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
        // so subscribers don't re-render on a no-op purge.
        if (!mutated) return state;
        return { entries: nextEntries };
      }),
  }),
);
