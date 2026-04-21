import { create } from "zustand";

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
