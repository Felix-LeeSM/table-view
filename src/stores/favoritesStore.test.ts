import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useFavoritesStore, SYNCED_KEYS } from "./favoritesStore";

describe("favoritesStore", () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    useFavoritesStore.setState({ favorites: [] });
    storage = {};
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
      get length() {
        return Object.keys(storage).length;
      },
      key: vi.fn(() => null),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -- CRUD --

  describe("addFavorite", () => {
    it("adds a global favorite", () => {
      useFavoritesStore.getState().addFavorite("My Query", "SELECT 1", null);

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.name).toBe("My Query");
      expect(state.favorites[0]!.sql).toBe("SELECT 1");
      expect(state.favorites[0]!.connectionId).toBeNull();
      expect(state.favorites[0]!.id).toMatch(/^fav-\d+$/);
    });

    it("adds a connection-scoped favorite", () => {
      useFavoritesStore
        .getState()
        .addFavorite("Conn Query", "SELECT * FROM users", "conn-1");

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.connectionId).toBe("conn-1");
    });

    it("generates unique IDs", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Q2", "SELECT 2", null);

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(2);
      expect(state.favorites[0]!.id).not.toBe(state.favorites[1]!.id);
    });

    it("sets createdAt and updatedAt to the same value", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);

      const state = useFavoritesStore.getState();
      const fav = state.favorites[0]!;
      expect(fav.createdAt).toBeGreaterThan(0);
      expect(fav.updatedAt).toBe(fav.createdAt);
    });
  });

  describe("removeFavorite", () => {
    it("removes a favorite by id", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Q2", "SELECT 2", null);

      const stateBefore = useFavoritesStore.getState();
      const idToRemove = stateBefore.favorites[0]!.id;

      useFavoritesStore.getState().removeFavorite(idToRemove);

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.name).toBe("Q2");
    });

    it("is a no-op for non-existent id", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      useFavoritesStore.getState().removeFavorite("fav-nonexistent");

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
    });
  });

  describe("updateFavorite", () => {
    it("updates name", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;

      useFavoritesStore.getState().updateFavorite(id, { name: "Updated" });

      const state = useFavoritesStore.getState();
      expect(state.favorites[0]!.name).toBe("Updated");
      expect(state.favorites[0]!.sql).toBe("SELECT 1");
    });

    it("updates sql", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;

      useFavoritesStore
        .getState()
        .updateFavorite(id, { sql: "SELECT * FROM users" });

      const state = useFavoritesStore.getState();
      expect(state.favorites[0]!.sql).toBe("SELECT * FROM users");
    });

    it("updates updatedAt timestamp", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;
      const originalUpdatedAt =
        useFavoritesStore.getState().favorites[0]!.updatedAt;

      useFavoritesStore.getState().updateFavorite(id, { name: "New" });

      const state = useFavoritesStore.getState();
      expect(state.favorites[0]!.updatedAt).toBeGreaterThanOrEqual(
        originalUpdatedAt,
      );
    });
  });

  // -- Filtering --

  describe("getFavorites", () => {
    it("returns only global favorites when connectionId is null", () => {
      useFavoritesStore.getState().addFavorite("Global", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Conn1", "SELECT 2", "conn-1");
      useFavoritesStore.getState().addFavorite("Conn2", "SELECT 3", "conn-2");

      const result = useFavoritesStore.getState().getFavorites(null);
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("Global");
    });

    it("returns connection-scoped and global for a specific connection", () => {
      useFavoritesStore.getState().addFavorite("Global", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Conn1", "SELECT 2", "conn-1");
      useFavoritesStore.getState().addFavorite("Conn2", "SELECT 3", "conn-2");

      const result = useFavoritesStore.getState().getFavorites("conn-1");
      expect(result).toHaveLength(2);
      const names = result.map((f) => f.name);
      expect(names).toContain("Global");
      expect(names).toContain("Conn1");
    });

    it("returns empty array when no favorites match", () => {
      useFavoritesStore.getState().addFavorite("Conn1", "SELECT 1", "conn-1");

      const result = useFavoritesStore.getState().getFavorites("conn-999");
      expect(result).toHaveLength(0);
    });
  });

  // -- Persistence --

  describe("persistence", () => {
    it("persists to localStorage on add", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);

      expect(storage["table-view-favorites"]).toBeDefined();
      const parsed = JSON.parse(storage["table-view-favorites"]!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("Q1");
    });

    it("persists to localStorage on remove", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Q2", "SELECT 2", null);

      const id = useFavoritesStore.getState().favorites[0]!.id;
      useFavoritesStore.getState().removeFavorite(id);

      const parsed = JSON.parse(storage["table-view-favorites"]!);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("Q2");
    });

    it("persists to localStorage on update", () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;

      useFavoritesStore.getState().updateFavorite(id, { name: "Updated" });

      const parsed = JSON.parse(storage["table-view-favorites"]!);
      expect(parsed[0].name).toBe("Updated");
    });

    it("loads persisted favorites", () => {
      storage["table-view-favorites"] = JSON.stringify([
        {
          id: "fav-99",
          name: "Persisted",
          sql: "SELECT 1",
          connectionId: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]);

      useFavoritesStore.getState().loadPersistedFavorites();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.name).toBe("Persisted");
    });

    it("updates counter to avoid ID collisions after loading", () => {
      storage["table-view-favorites"] = JSON.stringify([
        {
          id: "fav-500",
          name: "Old",
          sql: "SELECT 1",
          connectionId: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]);

      useFavoritesStore.getState().loadPersistedFavorites();

      useFavoritesStore.getState().addFavorite("New", "SELECT 2", null);

      const state = useFavoritesStore.getState();
      const newFav = state.favorites.find((f) => f.name === "New")!;
      expect(newFav.id).toMatch(/^fav-\d+$/);
      const numPart = parseInt(newFav.id.replace("fav-", ""), 10);
      expect(numPart).toBeGreaterThan(500);
    });

    it("handles corrupted localStorage gracefully", () => {
      storage["table-view-favorites"] = "not valid json{{{";

      expect(() =>
        useFavoritesStore.getState().loadPersistedFavorites(),
      ).not.toThrow();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toEqual([]);
    });

    it("handles empty localStorage", () => {
      useFavoritesStore.getState().loadPersistedFavorites();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toEqual([]);
    });
  });

  // -- State independence --

  describe("state independence", () => {
    it("tests do not leak state between runs", () => {
      // This test should start with empty favorites due to beforeEach reset
      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(0);
    });
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys ride the `favorites-sync`
  // channel. The `favorites` array is the only piece of shared state in the
  // store — actions are not subject to the bridge.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    it("exposes exactly the favorites array as the synced key", () => {
      expect([...SYNCED_KEYS]).toEqual(["favorites"]);
    });
  });
});
