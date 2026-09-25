/**
 * Written 2026-05-17 (the real fix for the per-window theme regression —
 * boot-time backend reconcile)
 *
 * User scenario (the regression's second root cause):
 *   1. The launcher changes theme to "github" → SQLite write (optimistic IPC)
 *   2. workspace-{conn_id} opens fresh — each Tauri 2 webview has its own
 *      localStorage, so the workspace's LS is empty.
 *   3. The workspace's `bootTheme()` (LS fast path) → first paint with
 *      DEFAULT_THEME_ID ("slate") = "slate flash"
 *   4. The async snapshot hydrate updates it on arrival, but meanwhile the
 *      user sees the slate colors → reported as "the theme applies per window"
 *
 * Fix: `reconcileThemeFromBackend()` applies the SQLite truth before the first
 * React render (see its JSDoc in `src/lib/themeBoot.ts`). This test locks its
 * invariants:
 *
 *   - SQLite holds a value different from LS → DOM data-theme changes to the
 *     SQLite value.
 *   - SQLite holds a value different from LS → LS is overwritten with the
 *     SQLite value (FOUC cache consistency for the next boot).
 *   - SQLite and LS agree → DOM/LS no-op (no needless write).
 *   - get_setting returns null (first boot, no settings yet) → no-op.
 *   - IPC throws (no Tauri) → graceful fallback, no throw.
 *   - SQLite value malformed → no-op, no throw.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  DEFAULT_THEME_ID,
  readStoredState,
  reconcileThemeFromBackend,
  THEME_STORAGE_KEY,
} from "./themeBoot";

const invokeMock = vi.mocked(invoke);

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

beforeEach(() => {
  invokeMock.mockReset();
  localStorageMock.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
});

describe("reconcileThemeFromBackend — Wave 9.5 회귀 7 boot reconcile", () => {
  it("SQLite truth 가 LS 와 다르면 DOM 의 data-theme 가 SQLite 값으로 변경", async () => {
    // Simulates a new webview boot: LS is empty, so it painted DEFAULT (slate).
    // Meanwhile SQLite holds "github", saved from the launcher.
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );

    await reconcileThemeFromBackend();

    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("SQLite truth 가 LS 와 다르면 LS 가 SQLite 값으로 덮어쓰임 (다음 boot FOUC 일관성)", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "linear", mode: "light" }),
    );

    await reconcileThemeFromBackend();

    expect(readStoredState()).toEqual({ themeId: "linear", mode: "light" });
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).not.toBeNull();
  });

  it("SQLite 와 LS 가 일치하면 LS write / DOM 변경 둘 다 no-op", async () => {
    // LS already holds "vercel/dark" (saved by the previous boot).
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "vercel", mode: "dark" }),
    );
    const lsBefore = localStorageMock.getItem(THEME_STORAGE_KEY);
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "vercel", mode: "dark" }),
    );

    await reconcileThemeFromBackend();

    // The raw LS string itself is unchanged (no needless re-stringify write).
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).toBe(lsBefore);
  });

  it("get_setting 이 null (첫 boot, settings 없음) 이면 no-op", async () => {
    invokeMock.mockResolvedValueOnce(null);
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME_ID);
    document.documentElement.setAttribute("data-mode", "light");

    await reconcileThemeFromBackend();

    // DOM unchanged — keeps the fast-path values bootTheme applied.
    expect(document.documentElement.getAttribute("data-theme")).toBe(
      DEFAULT_THEME_ID,
    );
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("IPC throw (Tauri 없는 환경 / capability 거부) — graceful fallback, throw 안 함", async () => {
    invokeMock.mockRejectedValueOnce(new Error("ipc unavailable"));

    await expect(reconcileThemeFromBackend()).resolves.toBeUndefined();
  });

  it("SQLite 값이 malformed JSON 이면 no-op + throw 안 함", async () => {
    invokeMock.mockResolvedValueOnce("not-a-json-{");

    await expect(reconcileThemeFromBackend()).resolves.toBeUndefined();
    // LS unchanged.
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("SQLite 값이 unknown themeId 면 no-op (catalog 에 없는 id 로 DOM 오염 회피)", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "no-such-theme", mode: "dark" }),
    );

    await reconcileThemeFromBackend();

    // The unknown id does not pollute the DOM.
    expect(document.documentElement.getAttribute("data-theme")).not.toBe(
      "no-such-theme",
    );
  });
});
