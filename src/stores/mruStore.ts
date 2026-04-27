import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

/**
 * Sprint 119 (#SHELL-1) — MRU (most-recently-used) connection store.
 *
 * Tracks the connection the user most recently engaged with (signal:
 * `addTab` / `addQueryTab` from `tabStore`). Consumed by `MainArea`'s
 * EmptyState so the New Query CTA defaults to the connection the user
 * actually cares about, not just the first one in the list.
 *
 * Persistence follows the same hand-rolled localStorage pattern as
 * `favoritesStore` — no zustand persist middleware, so the codebase has a
 * single, predictable persistence shape.
 */

const STORAGE_KEY = "table-view-mru";

function persistMru(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, id);
    }
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, private mode).
  }
}

function loadPersistedMru(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

interface MruState {
  lastUsedConnectionId: string | null;

  markConnectionUsed: (id: string) => void;
  loadPersistedMru: () => void;
}

/**
 * Sprint 153 — cross-window broadcast allowlist.
 *
 * Why `lastUsedConnectionId` is synced:
 *  - The launcher's "Recent" rail and the workspace's EmptyState CTA both
 *    read this value to highlight / default-target the connection the user
 *    most recently engaged with. Without sync, opening a tab in the
 *    workspace would leave the launcher's rail stale (and vice versa).
 *  - The value is a plain `string | null` — JSON-stable and free of
 *    secrets (it's just a connection id, not a credential).
 *
 * No keys are excluded — `MruState` only carries this single piece of
 * shared state, plus the actions (which are not state and therefore not
 * subject to the bridge).
 */
export const SYNCED_KEYS: ReadonlyArray<keyof MruState> = [
  "lastUsedConnectionId",
] as const;

export const useMruStore = create<MruState>((set) => ({
  lastUsedConnectionId: null,

  markConnectionUsed: (id) => {
    persistMru(id);
    set({ lastUsedConnectionId: id });
  },

  loadPersistedMru: () => {
    set({ lastUsedConnectionId: loadPersistedMru() });
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
  useMruStore.setState({ lastUsedConnectionId: null });
}
