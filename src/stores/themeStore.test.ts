// themeStore unit tests — covers hydrate, setTheme, setMode, setState,
// system-mode resolution, and the cross-window broadcast allowlist.
//
// 2026-05-16 update (Phase 4 sprint-368, Q12) — actions became
// backend-first (`persist_setting("theme", JSON)` IPC). Tests now mock
// `@tauri-apps/api/core` so the IPC resolves immediately in jsdom and
// await each action. The single-LS-write invariant locked here (AC-368
// receiver path) is byte-equivalent to the pre-368 behavior because the
// subscriber still owns the write — the action just no longer double-
// writes.
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useThemeStore, SYNCED_KEYS } from "./themeStore";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";

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

function stubSystemDark(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe("themeStore", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
    useThemeStore.getState().hydrate();
  });

  it("hydrates to defaults when no value is stored", () => {
    const state = useThemeStore.getState();
    expect(state.themeId).toBe(DEFAULT_THEME_ID);
    expect(state.mode).toBe("system");
  });

  it("hydrates from stored JSON state", () => {
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );
    useThemeStore.getState().hydrate();
    const state = useThemeStore.getState();
    expect(state.themeId).toBe("github");
    expect(state.mode).toBe("dark");
    expect(state.resolvedMode).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
  });

  it("setTheme updates themeId, data-theme, and persists JSON", async () => {
    await useThemeStore.getState().setTheme("github");
    expect(useThemeStore.getState().themeId).toBe("github");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    const raw = localStorageMock.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      themeId: "github",
      mode: "system",
    });
  });

  it("setMode updates mode, data-mode, and persists JSON", async () => {
    const restore = stubSystemDark(false);
    await useThemeStore.getState().setMode("dark");
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    const raw = localStorageMock.getItem(THEME_STORAGE_KEY);
    expect(JSON.parse(raw!)).toEqual({
      themeId: DEFAULT_THEME_ID,
      mode: "dark",
    });
    restore();
  });

  it("setState updates both themeId and mode together", async () => {
    await useThemeStore
      .getState()
      .setState({ themeId: "linear", mode: "light" });
    const state = useThemeStore.getState();
    expect(state.themeId).toBe("linear");
    expect(state.mode).toBe("light");
    expect(state.resolvedMode).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("linear");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("resolvedMode reflects prefers-color-scheme when mode is 'system'", async () => {
    const restoreDark = stubSystemDark(true);
    await useThemeStore.getState().setMode("system");
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    restoreDark();

    const restoreLight = stubSystemDark(false);
    useThemeStore.getState().handleSystemChange();
    expect(useThemeStore.getState().resolvedMode).toBe("light");
    restoreLight();
  });

  it("handleSystemChange is a no-op when mode is not 'system'", async () => {
    const restoreDark = stubSystemDark(false);
    await useThemeStore.getState().setMode("dark");
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    // System flips to prefers-light, but mode is explicit dark — no change expected.
    const restoreLight = stubSystemDark(false);
    useThemeStore.getState().handleSystemChange();
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    restoreLight();
    restoreDark();
  });

  it("preserves themeId when only mode changes", async () => {
    await useThemeStore.getState().setTheme("vercel");
    await useThemeStore.getState().setMode("light");
    expect(useThemeStore.getState().themeId).toBe("vercel");
    expect(document.documentElement.getAttribute("data-theme")).toBe("vercel");
  });

  it("preserves mode when only theme changes", async () => {
    const restore = stubSystemDark(false);
    await useThemeStore.getState().setMode("dark");
    await useThemeStore.getState().setTheme("linear");
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    restore();
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys ride the `theme-sync`
  // channel. `resolvedMode` is intentionally EXCLUDED — it is derived per
  // window from `prefers-color-scheme`, so broadcasting it would let one
  // window's system-theme interpretation overwrite the other's.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    it("exposes exactly the user-selected theme keys", () => {
      expect([...SYNCED_KEYS]).toEqual(["themeId", "mode"]);
    });

    it("does NOT include resolvedMode (per-window derived)", () => {
      expect(SYNCED_KEYS).not.toContain("resolvedMode");
    });
  });
});
