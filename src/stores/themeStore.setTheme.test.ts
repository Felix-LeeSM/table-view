/**
 * Written 2026-05-16 (AC-368-01)
 * 2026-05-17 update — the backend-first contract became optimistic UI; see
 * the note on `setTheme` in `ThemeStoreState` (`src/stores/themeStore.ts`).
 *
 * New contract:
 *   1. Store mutate right after the action call (sync — the subscriber fires
 *      at once → DOM/LS/cross-window)
 *   2. One fire-and-forget `persist_setting` IPC call
 *   3. On IPC reject: logger.warn + an error toast (#1092); the store keeps
 *      the mutated state (already applied from the user's view)
 *
 * On regression: (a) missing IPC → SQLite not updated + no cross-window
 * notification, (b) the store mutate is tied to the IPC response, so a stuck
 * backend leaves the click silently stuck again.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock `invoke` from `@tauri-apps/api/core` — it must be intercepted before
// module load so IPC calls can be asserted even in jsdom without a Tauri
// runtime. `vi.mock` is hoisted, so `vi.fn()` must be created only inside
// the factory.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";
import { invoke } from "@tauri-apps/api/core";
import { useThemeStore } from "./themeStore";

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
    // 2026-05-17 — the backend-first contract became optimistic, blocking
    // the path where a stuck backend left the user silently stuck.
    invokeMock.mockRejectedValueOnce(new Error("forced fail"));
    const initial = useThemeStore.getState();
    expect(initial.themeId).toBe(DEFAULT_THEME_ID);

    // No throw: the action persists fire-and-forget; a reject becomes
    // logger.warn + an error toast.
    await expect(
      useThemeStore.getState().setTheme("github"),
    ).resolves.toBeUndefined();

    // Store mutated optimistically — the invariant the user sees.
    expect(useThemeStore.getState().themeId).toBe("github");
    // LS written via subscriber — applied at once, together with the DOM.
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
