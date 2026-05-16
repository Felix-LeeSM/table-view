/**
 * 작성 2026-05-16 (Phase 4 sprint-368, AC-368-01)
 * 2026-05-17 update (Wave 9.5 회귀 6/7) — backend-first contract 를 optimistic
 * UI 로 전환. 진짜 사용자 보고 "테마 선택이 안 됨" 의 root cause 는 backend
 * reject / dev rebuild miss 시 store 가 mutate 안 되어 사용자가 silent stuck
 * 이었다. theme 같은 user preference 는 강한 일관성이 user-perceivable
 * 응답성보다 중요하지 않다 — 즉시 mutate + fire-and-forget persist, IPC
 * reject 는 logger.warn 만. SQLite 일관성은 next-boot reconcile path 가 복구.
 *
 * 새 contract:
 *   1. 액션 호출 직후 store mutate (sync — subscriber 즉시 fire → DOM/LS/cross-window)
 *   2. fire-and-forget `persist_setting` IPC 1회 호출
 *   3. IPC reject 시: logger.warn 만, store 상태 unchanged from mutate
 *      (사용자 시각에는 이미 적용된 상태)
 *
 * 회귀 시: (a) IPC 누락 → SQLite 갱신 안 됨 + cross-window 알림 누락,
 * (b) store mutate 가 IPC 응답에 묶여 backend stuck 시 click 후 silent
 * stuck 회귀 (Wave 9.5 회귀 6).
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

  it("setTheme IPC reject still mutates store (optimistic UI) + does NOT re-throw", async () => {
    // Wave 9.5 회귀 6/7 (2026-05-17) — backend-first contract 를 optimistic
    // 으로 전환. backend stuck 시 사용자가 silent stuck 회귀하던 path 를 차단.
    invokeMock.mockRejectedValueOnce(new Error("forced fail"));
    const initial = useThemeStore.getState();
    expect(initial.themeId).toBe(DEFAULT_THEME_ID);

    // No throw: action 은 fire-and-forget persist, reject 는 logger.warn 만.
    await expect(
      useThemeStore.getState().setTheme("github"),
    ).resolves.toBeUndefined();

    // Store mutated optimistically — 사용자가 보는 invariant.
    expect(useThemeStore.getState().themeId).toBe("github");
    // LS written via subscriber — DOM 과 같이 즉시 적용.
    const themeLsCalls = localStorageMock.setItem.mock.calls.filter(
      (call) => call[0] === THEME_STORAGE_KEY,
    );
    expect(themeLsCalls.length).toBeGreaterThanOrEqual(1);
    const last = themeLsCalls[themeLsCalls.length - 1]!;
    expect(JSON.parse(last[1])).toEqual({
      themeId: "github",
      mode: "system",
    });
  });
});
