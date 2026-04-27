import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FavoriteQuery {
  id: string;
  name: string;
  sql: string;
  /** null means global (not scoped to any connection) */
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type FavoriteScope = "all" | "global" | "connection";

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = "table-view-favorites";

function persistFavorites(favorites: FavoriteQuery[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, etc.)
  }
}

function loadPersistedFavorites(): FavoriteQuery[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as FavoriteQuery[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface FavoritesState {
  favorites: FavoriteQuery[];

  // Actions
  addFavorite: (name: string, sql: string, connectionId: string | null) => void;
  removeFavorite: (id: string) => void;
  updateFavorite: (
    id: string,
    updates: Partial<Pick<FavoriteQuery, "name" | "sql">>,
  ) => void;
  getFavorites: (connectionId: string | null) => FavoriteQuery[];
  loadPersistedFavorites: () => void;
}

/**
 * Sprint 153 — cross-window broadcast allowlist for the favorites store.
 *
 * Why `favorites` is synced:
 *  - User-curated query collection — must converge across launcher and
 *    workspace so adding a favorite in one window appears in the other
 *    without a manual reload.
 *  - Plain JSON-serializable: array of `FavoriteQuery` objects with only
 *    string/number/null fields.
 *  - Free of secrets: the SQL body may reference connection ids but
 *    carries no credentials.
 *
 * No keys are excluded — the store has a single piece of shared state.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof FavoritesState> = [
  "favorites",
] as const;

let favoriteCounter = 0;

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  favorites: [],

  addFavorite: (name, sql, connectionId) => {
    favoriteCounter++;
    const now = Date.now();
    const newFavorite: FavoriteQuery = {
      id: `fav-${favoriteCounter}`,
      name,
      sql,
      connectionId,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => {
      const favorites = [...state.favorites, newFavorite];
      persistFavorites(favorites);
      return { favorites };
    });
  },

  removeFavorite: (id) => {
    set((state) => {
      const favorites = state.favorites.filter((f) => f.id !== id);
      persistFavorites(favorites);
      return { favorites };
    });
  },

  updateFavorite: (id, updates) => {
    set((state) => {
      const favorites = state.favorites.map((f) =>
        f.id === id ? { ...f, ...updates, updatedAt: Date.now() } : f,
      );
      persistFavorites(favorites);
      return { favorites };
    });
  },

  getFavorites: (connectionId) => {
    const { favorites } = get();
    if (connectionId === null) {
      // Return global favorites only
      return favorites.filter((f) => f.connectionId === null);
    }
    // Return connection-scoped + global favorites
    return favorites.filter(
      (f) => f.connectionId === connectionId || f.connectionId === null,
    );
  },

  loadPersistedFavorites: () => {
    const favorites = loadPersistedFavorites();
    // Update counter to avoid ID collisions with persisted items
    for (const f of favorites) {
      const numPart = f.id.replace("fav-", "");
      const num = parseInt(numPart, 10);
      if (!isNaN(num) && num > favoriteCounter) {
        favoriteCounter = num;
      }
    }
    set({ favorites });
  },
}));

/**
 * Sprint 153 — opt the favorites store into the Sprint 151 bridge so
 * launcher and workspace observe the same `favorites` array. Symmetric:
 * adding/removing/updating a favorite from either window converges the
 * other. Persistence to localStorage is window-local (each window writes
 * its own `table-view-favorites` entry on every state change), which is
 * fine — both copies converge to the same content.
 */
void attachZustandIpcBridge<FavoritesState>(useFavoritesStore, {
  channel: "favorites-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: see mruStore.ts for the trade-off rationale.
});
