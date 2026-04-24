import { describe, it, expect, beforeEach, vi } from "vitest";
import { useThemeStore } from "./themeStore";
import { DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";

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

  it("setTheme updates themeId, data-theme, and persists JSON", () => {
    useThemeStore.getState().setTheme("github");
    expect(useThemeStore.getState().themeId).toBe("github");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    const raw = localStorageMock.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({
      themeId: "github",
      mode: "system",
    });
  });

  it("setMode updates mode, data-mode, and persists JSON", () => {
    const restore = stubSystemDark(false);
    useThemeStore.getState().setMode("dark");
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

  it("setState updates both themeId and mode together", () => {
    useThemeStore.getState().setState({ themeId: "linear", mode: "light" });
    const state = useThemeStore.getState();
    expect(state.themeId).toBe("linear");
    expect(state.mode).toBe("light");
    expect(state.resolvedMode).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("linear");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("resolvedMode reflects prefers-color-scheme when mode is 'system'", () => {
    const restoreDark = stubSystemDark(true);
    useThemeStore.getState().setMode("system");
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    restoreDark();

    const restoreLight = stubSystemDark(false);
    useThemeStore.getState().handleSystemChange();
    expect(useThemeStore.getState().resolvedMode).toBe("light");
    restoreLight();
  });

  it("handleSystemChange is a no-op when mode is not 'system'", () => {
    const restoreDark = stubSystemDark(false);
    useThemeStore.getState().setMode("dark");
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    // System flips to prefers-light, but mode is explicit dark — no change expected.
    const restoreLight = stubSystemDark(false);
    useThemeStore.getState().handleSystemChange();
    expect(useThemeStore.getState().resolvedMode).toBe("dark");
    restoreLight();
    restoreDark();
  });

  it("preserves themeId when only mode changes", () => {
    useThemeStore.getState().setTheme("vercel");
    useThemeStore.getState().setMode("light");
    expect(useThemeStore.getState().themeId).toBe("vercel");
    expect(document.documentElement.getAttribute("data-theme")).toBe("vercel");
  });

  it("preserves mode when only theme changes", () => {
    const restore = stubSystemDark(false);
    useThemeStore.getState().setMode("dark");
    useThemeStore.getState().setTheme("linear");
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    restore();
  });
});
