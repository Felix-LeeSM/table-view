/**
 * Written 2026-05-16 (state-management-strategy Phase 4 W2→W3, AC-370-04)
 *
 * Reason: entering W3 — favoritesStore has zero read sites for the LS key
 * `table-view-favorites`. Hydration after boot uses only the IPC
 * `list_favorites`. This test locks the regression at two layers:
 *
 *   1. **Static guard** — checks directly that `localStorage.getItem` /
 *      `getItem(STORAGE_KEY` do not appear in the favoritesStore.ts source.
 *      Not a single line may remain after the LS sweep. The write side
 *      (`localStorage.setItem` / `setItem(STORAGE_KEY`) is held to the same
 *      bar.
 *   2. **Runtime guard** — `loadPersistedFavorites` reads through the IPC
 *      `list_favorites` without touching LS. Persisting after addFavorite
 *      also goes through the IPC, with zero LS writes.
 *
 * On regression: (a) hand-rolled LS persistence comes back and causes
 * cross-window drift, (b) on an IPC reject the store keeps stale values
 * through a partial hydrate.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const invokeMock = vi.mocked(invoke);

// In-memory localStorage spy — anything that writes here trips a runtime test.
const localStorageMock = (() => {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue([]);
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear();
});

describe("AC-370-04 favoritesStore LS read site 0", () => {
  it("source of favoritesStore.ts has zero localStorage.getItem call", () => {
    // Static guard — read the file from disk and assert the substring is
    // gone. Lock-in pattern from the datagrid LS retirement.
    const src = readFileSync(resolve(__dirname, "favoritesStore.ts"), "utf-8");
    expect(src.includes("localStorage.getItem")).toBe(false);
    expect(src.includes("getItem(STORAGE_KEY")).toBe(false);
  });

  it("source of favoritesStore.ts has zero localStorage.setItem call", () => {
    const src = readFileSync(resolve(__dirname, "favoritesStore.ts"), "utf-8");
    expect(src.includes("localStorage.setItem")).toBe(false);
    expect(src.includes("setItem(STORAGE_KEY")).toBe(false);
  });

  it("loadPersistedFavorites calls list_favorites IPC, NOT localStorage", async () => {
    invokeMock.mockResolvedValueOnce([
      {
        id: "fav-x",
        name: "Saved",
        sql: "SELECT 1",
        connectionId: null,
        createdAt: 100,
        updatedAt: 100,
      },
    ]);

    const { useFavoritesStore } = await import("./favoritesStore");

    await useFavoritesStore.getState().loadPersistedFavorites();

    const listCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "list_favorites",
    );
    expect(listCalls.length).toBeGreaterThanOrEqual(1);
    expect(localStorageMock.getItem.mock.calls.length).toBe(0);

    // Hydrated payload is observable in the store.
    const fav = useFavoritesStore
      .getState()
      .favorites.find((f) => f.id === "fav-x");
    expect(fav).toBeDefined();
    expect(fav?.name).toBe("Saved");
  });

  it("addFavorite persists via IPC and does NOT write to localStorage", async () => {
    const { useFavoritesStore } = await import("./favoritesStore");

    // Reset store to known empty.
    useFavoritesStore.setState({ favorites: [] });
    invokeMock.mockResolvedValue(undefined);
    localStorageMock.setItem.mockClear();

    useFavoritesStore.getState().addFavorite("My Query", "SELECT 1", null);

    // Allow microtask flush — the action persists asynchronously.
    await Promise.resolve();
    await Promise.resolve();

    const persistCalls = invokeMock.mock.calls.filter(
      (c) => c[0] === "persist_favorites",
    );
    expect(persistCalls.length).toBeGreaterThanOrEqual(1);
    expect(localStorageMock.setItem.mock.calls.length).toBe(0);
  });
});
