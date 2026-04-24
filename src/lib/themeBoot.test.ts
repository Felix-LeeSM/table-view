import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyMode,
  applyTheme,
  bootTheme,
  readStoredMode,
  readStoredState,
  resolveMode,
  subscribeSystemModeChange,
  writeStoredState,
  THEME_STORAGE_KEY,
  DEFAULT_THEME_ID,
} from "./themeBoot";

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

describe("themeBoot", () => {
  beforeEach(() => {
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-mode");
  });

  describe("readStoredMode", () => {
    it("returns 'system' when no value is stored", () => {
      expect(readStoredMode()).toBe("system");
    });

    it("returns stored legacy light/dark/system strings verbatim", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(readStoredMode()).toBe("dark");
      localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(readStoredMode()).toBe("light");
      localStorage.setItem(THEME_STORAGE_KEY, "system");
      expect(readStoredMode()).toBe("system");
    });

    it("falls back to 'system' for unparseable values", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "midnight");
      expect(readStoredMode()).toBe("system");
    });
  });

  describe("readStoredState", () => {
    it("returns default state when no value is stored", () => {
      expect(readStoredState()).toEqual({
        themeId: DEFAULT_THEME_ID,
        mode: "system",
      });
    });

    it("migrates legacy string values to state with default theme id", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(readStoredState()).toEqual({
        themeId: DEFAULT_THEME_ID,
        mode: "dark",
      });
    });

    it("parses JSON-formatted stored state", () => {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ themeId: "github", mode: "dark" }),
      );
      expect(readStoredState()).toEqual({ themeId: "github", mode: "dark" });
    });

    it("falls back to default theme id when JSON contains unknown id", () => {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ themeId: "not-a-theme", mode: "dark" }),
      );
      expect(readStoredState()).toEqual({
        themeId: DEFAULT_THEME_ID,
        mode: "dark",
      });
    });

    it("falls back to 'system' mode when JSON mode is invalid", () => {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ themeId: "github", mode: "weird" }),
      );
      expect(readStoredState()).toEqual({
        themeId: "github",
        mode: "system",
      });
    });

    it("falls back to default state when JSON is malformed", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "{not:json}");
      expect(readStoredState()).toEqual({
        themeId: DEFAULT_THEME_ID,
        mode: "system",
      });
    });
  });

  describe("writeStoredState", () => {
    it("writes JSON-formatted value to localStorage", () => {
      writeStoredState({ themeId: "github", mode: "dark" });
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual({ themeId: "github", mode: "dark" });
    });
  });

  describe("resolveMode", () => {
    it("returns literal mode for light/dark", () => {
      expect(resolveMode("light")).toBe("light");
      expect(resolveMode("dark")).toBe("dark");
    });

    it("resolves 'system' via prefers-color-scheme", () => {
      const mql = {
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const original = window.matchMedia;
      window.matchMedia = vi
        .fn()
        .mockReturnValue(mql) as typeof window.matchMedia;
      expect(resolveMode("system")).toBe("dark");
      mql.matches = false;
      expect(resolveMode("system")).toBe("light");
      window.matchMedia = original;
    });
  });

  describe("applyMode", () => {
    it("sets data-theme to the default theme id", () => {
      applyMode("light");
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        DEFAULT_THEME_ID,
      );
    });

    it("sets data-mode to the resolved mode", () => {
      applyMode("dark");
      expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
      applyMode("light");
      expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    });
  });

  describe("applyTheme", () => {
    it("sets data-theme to the provided theme id", () => {
      applyTheme("github", "light");
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        "github",
      );
    });

    it("sets data-mode to the resolved mode", () => {
      applyTheme("linear", "dark");
      expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    });

    it("returns the resolved mode", () => {
      expect(applyTheme("vercel", "light")).toBe("light");
      expect(applyTheme("vercel", "dark")).toBe("dark");
    });
  });

  describe("bootTheme", () => {
    it("applies stored mode synchronously on call", () => {
      localStorage.setItem(THEME_STORAGE_KEY, "dark");
      bootTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        DEFAULT_THEME_ID,
      );
      expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    });

    it("applies persisted JSON themeId + mode", () => {
      localStorage.setItem(
        THEME_STORAGE_KEY,
        JSON.stringify({ themeId: "github", mode: "dark" }),
      );
      bootTheme();
      expect(document.documentElement.getAttribute("data-theme")).toBe(
        "github",
      );
      expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    });

    it("falls back to system resolution when no value is stored", () => {
      const mql = {
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      const original = window.matchMedia;
      window.matchMedia = vi
        .fn()
        .mockReturnValue(mql) as typeof window.matchMedia;
      bootTheme();
      expect(document.documentElement.getAttribute("data-mode")).toBe("light");
      window.matchMedia = original;
    });
  });

  describe("subscribeSystemModeChange", () => {
    it("registers a listener on the prefers-color-scheme media query", () => {
      const addEventListener = vi.fn();
      const removeEventListener = vi.fn();
      const original = window.matchMedia;
      window.matchMedia = vi.fn().mockReturnValue({
        matches: false,
        addEventListener,
        removeEventListener,
      }) as typeof window.matchMedia;

      const handler = vi.fn();
      const unsubscribe = subscribeSystemModeChange(handler);
      expect(addEventListener).toHaveBeenCalledWith("change", handler);
      unsubscribe();
      expect(removeEventListener).toHaveBeenCalledWith("change", handler);

      window.matchMedia = original;
    });
  });
});
