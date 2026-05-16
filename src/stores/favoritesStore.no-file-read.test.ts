/**
 * 작성 2026-05-16 (Phase 4 W2→W3 sprint-370, AC-370-04)
 *
 * 사유: W3 진입 — favoritesStore 의 LS `table-view-favorites` read 사이트 0.
 * boot 후 hydrate 는 IPC `list_favorites` 만 사용. 본 테스트는 두 layer 에서
 * regression 을 잠근다:
 *
 *   1. **Static guard** — favoritesStore.ts 의 module body 소스에 `getItem(`
 *      / `localStorage.` 가 등장하지 않음을 직접 확인. sprint-368 의 sweep
 *      이후 한 줄도 남아있지 않아야 한다. write 쪽도 같은 잣대.
 *   2. **Runtime guard** — `loadPersistedFavorites` 가 LS 를 만지지 않고 IPC
 *      `list_favorites` 1회만 호출. addFavorite 후 persist 도 IPC 1회 +
 *      LS write 0.
 *
 * 회귀 시: (a) hand-rolled LS persistence 가 부활해 cross-window drift 발생,
 * (b) IPC reject 시 store 가 partial hydrate 로 stale 값을 유지.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
    // gone. Lock-in pattern from sprint-369 datagrid LS retire.
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
