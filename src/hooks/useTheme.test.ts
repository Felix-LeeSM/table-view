import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTheme } from "./useTheme";
import { useThemeStore } from "@stores/themeStore";

// Mock localStorage for jsdom
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

function hydrateStore() {
  useThemeStore.getState().hydrate();
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
    hydrateStore();
  });

  it("defaults to system theme when no stored preference", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("reads stored theme from legacy string localStorage value", () => {
    localStorage.setItem("table-view-theme", "dark");
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("applies data-mode=dark for dark theme", () => {
    localStorage.setItem("table-view-theme", "dark");
    hydrateStore();
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("applies data-mode=light for light theme", () => {
    localStorage.setItem("table-view-theme", "light");
    hydrateStore();
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("sets data-theme=slate on mount by default", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("slate");
  });

  it("setTheme persists JSON state and updates data-mode", () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    const raw = localStorage.getItem("table-view-theme");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ themeId: "slate", mode: "dark" });
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("switches from dark to light", () => {
    localStorage.setItem("table-view-theme", "dark");
    hydrateStore();
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("falls back to system when legacy localStorage value is unparseable", () => {
    localStorage.setItem("table-view-theme", "invalid-value");
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("reads JSON-formatted stored state", () => {
    localStorage.setItem(
      "table-view-theme",
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
  });
});
