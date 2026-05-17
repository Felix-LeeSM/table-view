import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import { logger } from "@lib/logger";

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
// IPC persistence
// ---------------------------------------------------------------------------
//
// Sprint 370 (Phase 4 W2→W3) — backend SQLite is the single SOT. The
// hand-rolled `table-view-favorites` localStorage persistence is retired
// (sprint-370 AC-370-04). Every mutate path now serializes the full list
// and ships it through `persist_favorites` IPC; boot hydration reads the
// canonical list back via `list_favorites`.
//
// The IPC fire-and-forget mirrors the previous LS write semantics — the
// store mutates synchronously so the UI surface stays optimistic; the
// IPC log surfaces failures. A reject does NOT roll the store back today
// because the legacy LS path also could not roll back a write — the
// invariant the contract preserves is "no user-visible regression vs
// W2", not "stricter consistency than W2 had". A future sprint may add
// per-action rollback once event/state-changed lands for favorites.

interface PersistFavoritePayload {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

function toPersistPayload(
  favorites: FavoriteQuery[],
): PersistFavoritePayload[] {
  return favorites.map((f, idx) => ({
    id: f.id,
    name: f.name,
    sql: f.sql,
    connectionId: f.connectionId,
    sortOrder: idx,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
  }));
}

function persistFavorites(favorites: FavoriteQuery[]): void {
  // Fire-and-forget — see module doc for why we keep this pattern. We log
  // failures so dev console shows the SQLite write error, but the store
  // mutate has already happened by the time we're here.
  void invoke("persist_favorites", {
    favorites: toPersistPayload(favorites),
  }).catch((e: unknown) => {
    const message = e instanceof Error ? e.message : String(e ?? "");
    logger.warn(`[favoritesStore] persist_favorites failed: ${message}`);
  });
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
  /**
   * Sprint 370 — hydrate from SQLite via `list_favorites` IPC. Previously
   * read from `table-view-favorites` localStorage; the LS path is now
   * retired and the snapshot IPC (`get_initial_app_state`) does not carry
   * favorites (lazy mount-time IPC by contract), so this entrypoint is the
   * sole hydrate path.
   */
  loadPersistedFavorites: () => Promise<void>;
}

/**
 * Cross-window broadcast allowlist. Only `favorites` is shared so a
 * favorite added in either window converges the other. Plain JSON; the
 * SQL body may reference connection ids but carries no credentials.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof FavoritesState> = [
  "favorites",
] as const;

let favoriteCounter = 0;

/**
 * Sprint 375 (Phase 6 cleanup, 2026-05-17) — test-only escape hatch for
 * the module-scope `favoriteCounter`. The counter is intentionally
 * module-scope (not Zustand state) so the seed walk in
 * `loadPersistedFavorites` can ratchet it monotonically without going
 * through a `setState` round-trip; that means `useFavoritesStore.setState(
 * { favorites: [] })` cannot reset it back to zero for the next test.
 * Mirrors `__resetCountersForTests` in `workspaceStore.ts` (sprint-354)
 * and `__resetDocumentStoreForTests` in `documentStore.ts`. Namespaced
 * `__` to flag intent.
 */
export function __resetFavoriteCounterForTests(): void {
  favoriteCounter = 0;
}

interface FavoriteRow {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

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

  loadPersistedFavorites: async () => {
    try {
      const rows = await invoke<FavoriteRow[]>("list_favorites");
      const favorites: FavoriteQuery[] = Array.isArray(rows)
        ? rows.map((r) => ({
            id: r.id,
            name: r.name,
            sql: r.sql,
            connectionId: r.connectionId,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          }))
        : [];

      // Update counter to avoid ID collisions with persisted items.
      for (const f of favorites) {
        const numPart = f.id.replace("fav-", "");
        const num = parseInt(numPart, 10);
        if (!isNaN(num) && num > favoriteCounter) {
          favoriteCounter = num;
        }
      }

      set({ favorites });
    } catch (e) {
      // Best-effort: backend may be unavailable in tests where the Tauri
      // runtime mock is missing. Surface a debug log so regressions in IPC
      // wiring still leave a breadcrumb, but keep the store at its default
      // so callers can't observe a partial hydrate.
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(`[favoritesStore] list_favorites failed: ${message}`);
    }
  },
}));

/**
 * Symmetric attach. Both windows still listen so a favorite added in one
 * converges the other through the bridge; backend SQLite is the durable
 * source on the next boot.
 */
void attachZustandIpcBridge<FavoritesState>(useFavoritesStore, {
  channel: "favorites-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: see mruStore.ts for the trade-off rationale.
});
