/**
 * 작성 2026-05-16 (Phase 4 sprint-368, AC-368-01)
 *
 * 사유: Q12 Theme/SafeMode SQLite SOT 전환 — `setTheme` / `setMode` 액션은
 * IPC `set_setting("theme", JSON)` (backend-first) 호출 후에만 store 를
 * mutate 하고 LS (`table-view-theme`) 에 sync write 해야 한다.
 *
 *   1. IPC `persist_setting({key:"theme", valueJson: …})` 1회 호출
 *   2. 응답 후 store mutate (themeId / mode)
 *   3. LS sync write 1회 (FOUC cache)
 *
 * 회귀 시: (a) 직접 LS write 만 일어나 SQLite 에 반영 안 됨, (b) IPC reject
 * 시 store 가 stale 값으로 남아 다른 window 와 불일치.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// `@tauri-apps/api/core` 의 invoke 를 mock — Tauri runtime 없는 jsdom 에서도
// IPC 호출을 단언할 수 있도록 module-load 전에 가로채야 한다. `vi.mock` 는
// 호이스팅되므로 factory 안에서만 `vi.fn()` 을 생성해야 한다.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "./themeStore";
import { THEME_STORAGE_KEY, DEFAULT_THEME_ID } from "@lib/themeBoot";

const invokeMock = vi.mocked(invoke);

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

interface PersistRequestBody {
  req: { key: string; valueJson: string };
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  localStorageMock.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  // Reset store to defaults — this triggers the subscriber LS write before
  // the test begins, so the `mockClear` MUST come after the setState so
  // per-test assertions count only the writes triggered by the action.
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID, mode: "system" });
  localStorageMock.setItem.mockClear();
});

describe("AC-368-01 setTheme backend-first", () => {
  it("setTheme invokes persist_setting IPC with theme key and JSON value", async () => {
    await useThemeStore.getState().setTheme("github");

    const themeCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "persist_setting",
    );
    expect(themeCalls).toHaveLength(1);
    const firstCall = themeCalls[0];
    expect(firstCall).toBeDefined();
    const req = firstCall![1] as unknown as PersistRequestBody;
    expect(req.req.key).toBe("theme");
    expect(JSON.parse(req.req.valueJson)).toEqual({
      themeId: "github",
      mode: "system",
    });
  });

  it("setTheme mutates store after IPC resolves", async () => {
    await useThemeStore.getState().setTheme("github");
    expect(useThemeStore.getState().themeId).toBe("github");
  });

  it("setTheme writes LS sync once after IPC resolves", async () => {
    await useThemeStore.getState().setTheme("github");

    const themeLsCalls = localStorageMock.setItem.mock.calls.filter(
      (call) => call[0] === THEME_STORAGE_KEY,
    );
    expect(themeLsCalls).toHaveLength(1);
    const first = themeLsCalls[0]!;
    expect(JSON.parse(first[1])).toEqual({
      themeId: "github",
      mode: "system",
    });
  });

  it("setMode invokes persist_setting IPC and combines themeId+mode", async () => {
    useThemeStore.setState({ themeId: "github", mode: "system" });
    invokeMock.mockClear();
    localStorageMock.setItem.mockClear();

    await useThemeStore.getState().setMode("dark");

    const themeCalls = invokeMock.mock.calls.filter(
      (call) => call[0] === "persist_setting",
    );
    expect(themeCalls).toHaveLength(1);
    const req = themeCalls[0]![1] as unknown as PersistRequestBody;
    expect(JSON.parse(req.req.valueJson)).toEqual({
      themeId: "github",
      mode: "dark",
    });
    expect(useThemeStore.getState().mode).toBe("dark");
  });

  it("setTheme IPC reject does NOT mutate store nor write LS", async () => {
    invokeMock.mockRejectedValueOnce(new Error("forced fail"));
    const initial = useThemeStore.getState();
    expect(initial.themeId).toBe(DEFAULT_THEME_ID);

    await expect(useThemeStore.getState().setTheme("github")).rejects.toThrow(
      "forced fail",
    );

    // Store unchanged
    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
    // LS not written for theme key
    const themeLsCalls = localStorageMock.setItem.mock.calls.filter(
      (call) => call[0] === THEME_STORAGE_KEY,
    );
    expect(themeLsCalls).toHaveLength(0);
  });
});
