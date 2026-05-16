// 작성 (legacy) — `useTheme` hook 의 backwards-compat 검증.
// 2026-05-16 update (Phase 4 sprint-368) — `setMode` 가 IPC 호출이 된 후
// `@tauri-apps/api/core` 를 mock 해 jsdom 에서 await 가능. `setTheme` 호출
// 후 LS write 단언은 subscriber 의 sync write 를 기다리도록 await 추가.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useTheme } from "./useTheme";
import { useThemeStore } from "@stores/themeStore";
import { THEME_STORAGE_KEY } from "@lib/themeBoot";

const invokeMock = vi.mocked(invoke);

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
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
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
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
  });

  it("applies data-mode=dark for dark theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    hydrateStore();
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("applies data-mode=light for light theme", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    hydrateStore();
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("sets data-theme=slate on mount by default", () => {
    renderHook(() => useTheme());
    expect(document.documentElement.getAttribute("data-theme")).toBe("slate");
  });

  it("setTheme persists JSON state and updates data-mode", async () => {
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setTheme("dark");
    });

    expect(result.current.theme).toBe("dark");
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ themeId: "slate", mode: "dark" });
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("switches from dark to light", async () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    hydrateStore();
    const { result } = renderHook(() => useTheme());

    await act(async () => {
      await result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
  });

  it("falls back to system when legacy localStorage value is unparseable", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "invalid-value");
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("system");
  });

  it("reads JSON-formatted stored state", () => {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );
    hydrateStore();
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
  });
});
