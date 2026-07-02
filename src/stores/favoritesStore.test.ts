import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 작성 2026-05-16 (Phase 4 W2→W3 sprint-370)
//
// 사유: favoritesStore 의 LS retire 후 영속 채널이 SQLite IPC 로 이동했다.
// 본 파일은 Sprint 119 / 153 / 290 시점의 행동 contract — CRUD / scope
// 필터링 / SYNCED_KEYS 노출 — 을 보존하면서 영속 단언만 IPC 로 옮긴다.
// LS 단언은 `favoritesStore.no-file-read.test.ts` 가 별도로 잠근다.

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
    clear: vi.fn(),
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { toast } from "@lib/runtime/toast";
import { useFavoritesStore, SYNCED_KEYS } from "./favoritesStore";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invokeMock = vi.mocked(invoke);
const toastErrorMock = vi.mocked(toast.error);

describe("favoritesStore", () => {
  beforeEach(() => {
    useFavoritesStore.setState({ favorites: [] });
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  // -- Persistence (Sprint 370 — SQLite via persist_favorites IPC) --

  describe("persistence (sprint-370 SQLite SOT)", () => {
    it("keeps store IPC behind the typed Tauri wrapper", () => {
      const src = readFileSync(
        resolve(__dirname, "favoritesStore.ts"),
        "utf-8",
      );

      expect(src).not.toContain("@tauri-apps/api/core");
    });

    it("ships every mutate to persist_favorites IPC", async () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      await Promise.resolve();

      const calls = invokeMock.mock.calls.filter(
        (c) => c[0] === "persist_favorites",
      );
      expect(calls.length).toBeGreaterThanOrEqual(1);
      const payload = calls[0]![1] as {
        favorites: Array<{ name: string; sql: string }>;
      };
      expect(payload.favorites).toHaveLength(1);
      expect(payload.favorites[0]!.name).toBe("Q1");
    });

    it("removeFavorite re-ships the trimmed list to persist_favorites", async () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      useFavoritesStore.getState().addFavorite("Q2", "SELECT 2", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;
      invokeMock.mockClear();

      useFavoritesStore.getState().removeFavorite(id);
      await Promise.resolve();

      const calls = invokeMock.mock.calls.filter(
        (c) => c[0] === "persist_favorites",
      );
      expect(calls.length).toBe(1);
      const payload = calls[0]![1] as {
        favorites: Array<{ name: string }>;
      };
      expect(payload.favorites).toHaveLength(1);
      expect(payload.favorites[0]!.name).toBe("Q2");
    });

    it("updateFavorite re-ships the updated list", async () => {
      useFavoritesStore.getState().addFavorite("Q1", "SELECT 1", null);
      const id = useFavoritesStore.getState().favorites[0]!.id;
      invokeMock.mockClear();

      useFavoritesStore.getState().updateFavorite(id, { name: "Updated" });
      await Promise.resolve();

      const calls = invokeMock.mock.calls.filter(
        (c) => c[0] === "persist_favorites",
      );
      expect(calls.length).toBe(1);
      const payload = calls[0]![1] as {
        favorites: Array<{ name: string }>;
      };
      expect(payload.favorites[0]!.name).toBe("Updated");
    });

    it("loadPersistedFavorites hydrates from list_favorites IPC", async () => {
      invokeMock.mockResolvedValueOnce([
        {
          id: "fav-500",
          name: "Persisted",
          sql: "SELECT 1",
          connectionId: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]);

      await useFavoritesStore.getState().loadPersistedFavorites();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.name).toBe("Persisted");
    });

    it("updates counter to avoid ID collisions after loading", async () => {
      invokeMock.mockResolvedValueOnce([
        {
          id: "fav-500",
          name: "Old",
          sql: "SELECT 1",
          connectionId: null,
          createdAt: 1000,
          updatedAt: 1000,
        },
      ]);

      await useFavoritesStore.getState().loadPersistedFavorites();

      useFavoritesStore.getState().addFavorite("New", "SELECT 2", null);

      const state = useFavoritesStore.getState();
      const newFav = state.favorites.find((f) => f.name === "New")!;
      expect(newFav.id).toMatch(/^fav-\d+$/);
      const numPart = parseInt(newFav.id.replace("fav-", ""), 10);
      expect(numPart).toBeGreaterThan(500);
    });

    it("handles IPC reject gracefully (store stays at default)", async () => {
      invokeMock.mockRejectedValueOnce(new Error("forced fail"));

      await expect(
        useFavoritesStore.getState().loadPersistedFavorites(),
      ).resolves.toBeUndefined();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toEqual([]);
    });

    it("handles empty IPC response", async () => {
      invokeMock.mockResolvedValueOnce([]);

      await useFavoritesStore.getState().loadPersistedFavorites();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toEqual([]);
    });
  });

  // Regression (#1092) — a rejected persist_favorites IPC (SQLite write
  // failure with no file/LS fallback and no wired boot reconcile) must
  // surface to the user, not be swallowed as a dev-only log.
  describe("persist failure surfacing (#1092)", () => {
    it("shows an error toast when persist_favorites rejects", async () => {
      invokeMock.mockRejectedValueOnce(new Error("disk full"));

      useFavoritesStore.getState().addFavorite("Q", "SELECT 1", null);

      await vi.waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
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
