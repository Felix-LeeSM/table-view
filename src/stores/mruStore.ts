import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

/**
 * Sprint 166 — MRU entry representing a single recently-used connection.
 *
 * `lastUsed` is a `Date.now()` epoch ms timestamp so the launcher's "Recent"
 * rail can render relative-time labels ("2 min ago") without querying the
 * connection store.
 */
export interface MruEntry {
  connectionId: string;
  lastUsed: number; // Date.now() timestamp
}

/**
 * Sprint 119 (#SHELL-1) — MRU (most-recently-used) connection store.
 *
 * Tracks the connections the user most recently engaged with (signal:
 * `addTab` / `addQueryTab` from `tabStore`). Consumed by `MainArea`'s
 * EmptyState so the New Query CTA defaults to the connection the user
 * actually cares about, not just the first one in the list.
 *
 * Sprint 166 — expanded from a single `lastUsedConnectionId` to an ordered
 * list of up to 5 entries (`recentConnections`). The legacy field is kept as
 * a derived read for backward compatibility.
 *
 * Persistence follows the same hand-rolled localStorage pattern as
 * `favoritesStore` — no zustand persist middleware, so the codebase has a
 * single, predictable persistence shape.
 */

const STORAGE_KEY = "table-view-mru";
const MAX_ENTRIES = 5;

function persistMruList(entries: MruEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, private mode).
  }
}

/**
 * Load persisted MRU entries from localStorage.
 *
 * Sprint 166 — handles two formats:
 *  1. New format: JSON array of `MruEntry` objects.
 *  2. Legacy format (Sprint 119): a plain connection-id string.
 *
 * Migration is transparent — if the stored value is a plain string, it is
 * converted to a single-element list with `lastUsed: Date.now()`. The next
 * write persists the new format, completing the migration.
 */
function loadPersistedMruList(): MruEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.slice(0, MAX_ENTRIES);
      }
      // Legacy format (Sprint 119): JSON-quoted string (e.g. `"c1"`).
      if (typeof parsed === "string" && parsed.length > 0) {
        return [{ connectionId: parsed, lastUsed: Date.now() }];
      }
      return [];
    } catch {
      // Legacy format (Sprint 119): unquoted plain string (e.g. `c1`).
      // `JSON.parse("c1")` throws because bare identifiers are not valid
      // JSON — the old store wrote the id verbatim via `setItem(key, id)`.
      if (raw.length > 0) {
        return [{ connectionId: raw, lastUsed: Date.now() }];
      }
      return [];
    }
  } catch {
    return [];
  }
}

interface MruState {
  lastUsedConnectionId: string | null; // derived: recentConnections[0]?.connectionId ?? null (backward compat)
  recentConnections: MruEntry[]; // ordered list, most recent first

  markConnectionUsed: (id: string) => void;
  loadPersistedMru: () => void;
}

/**
 * Sprint 166 — cross-window broadcast allowlist.
 *
 * Why `lastUsedConnectionId` is synced:
 *  - The launcher's "Recent" rail and the workspace's EmptyState CTA both
 *    read this value to highlight / default-target the connection the user
 *    most recently engaged with. Without sync, opening a tab in the
 *    workspace would leave the launcher's rail stale (and vice versa).
 *  - The value is a plain `string | null` — JSON-stable and free of
 *    secrets (it's just a connection id, not a credential).
 *
 * Why `recentConnections` is synced (Sprint 166):
 *  - The launcher's recent-connections list should reflect actions taken in
 *    any window. Without sync, opening a tab in the workspace would not
 *    surface that connection in the launcher's "Recent" section.
 *  - The value is a JSON array of `{ connectionId, lastUsed }` —
 *    JSON-serializable and free of secrets.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof MruState> = [
  "lastUsedConnectionId",
  "recentConnections",
] as const;

export const useMruStore = create<MruState>((set) => ({
  lastUsedConnectionId: null,
  recentConnections: [],

  markConnectionUsed: (id) => {
    const now = Date.now();
    set((state) => {
      // Remove existing entry for this id (if any), then prepend.
      const filtered = state.recentConnections.filter(
        (e) => e.connectionId !== id,
      );
      const updated: MruEntry[] = [
        { connectionId: id, lastUsed: now },
        ...filtered,
      ].slice(0, MAX_ENTRIES);
      // Persist
      persistMruList(updated);
      return {
        recentConnections: updated,
        lastUsedConnectionId: id, // backward compat
      };
    });
  },

  loadPersistedMru: () => {
    const entries = loadPersistedMruList();
    set({
      recentConnections: entries,
      lastUsedConnectionId: entries[0]?.connectionId ?? null,
    });
  },
}));

/**
 * Sprint 153 — opt the MRU store into the Sprint 151 bridge so launcher
 * and workspace observe the same `lastUsedConnectionId`. Attached ONCE
 * at module load (mirrors `connectionStore`'s pattern). Symmetric: both
 * windows attach unconditionally — either side may mark a connection
 * used and the other should see the result.
 *
 * `originId` falls back to `"unknown"` when the Tauri window label is
 * unavailable (vitest jsdom). Sprint 152 evaluator advisory #1 — using
 * `"unknown"` instead of `"test"` keeps the loop guard distinct between
 * any future stores that share a fallback in the same process.
 */
void attachZustandIpcBridge<MruState>(useMruStore, {
  channel: "mru-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: if the listen registration fails (e.g. Tauri runtime not
  // available outside vitest mocks), the store still works window-local.
});

/**
 * Reset hook for tests. Wipes both the in-memory state and the
 * persisted entry so a single test cannot leak MRU into the next.
 */
export function __resetMruStoreForTests(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  useMruStore.setState({ lastUsedConnectionId: null, recentConnections: [] });
}
