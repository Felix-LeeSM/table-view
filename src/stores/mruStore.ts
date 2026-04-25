import { create } from "zustand";

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
