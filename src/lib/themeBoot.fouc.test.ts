/**
 * Written 2026-05-16 (AC-368-05)
 *
 * Reason: state-management-strategy Q12 FOUC-0 invariant — at boot the LS
 * `table-view-theme` cache can briefly disagree with the SQLite truth (e.g.
 * another window changed it and this window has not received it through the
 * listener yet). The first paint must apply the LS cache value immediately so
 * no flash is visible. The SQLite truth updates silently after the snapshot
 * IPC responds.
 *
 * This jsdom test checks the following sequence:
 *   1. LS holds `{themeId:"github", mode:"light"}` (the previous boot's last
 *      success)
 *   2. Right after `bootTheme()` (sync), document.documentElement's `data-mode`
 *      is "light" — no IPC response received yet
 *   3. When the boot snapshot later brings `mode:"dark"`, it updates silently
 *      (simulated with a `useThemeStore.setState` call)
 *
 * On regression: the LS read site disappears, so the first paint starts from
 * the default (system) → a dark-mode user's screen flashes light → then turns
 * dark right away.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { bootTheme, DEFAULT_THEME_ID, THEME_STORAGE_KEY } from "@lib/themeBoot";
import { useThemeStore } from "@stores/themeStore";

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
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mode");
  useThemeStore.setState({ themeId: DEFAULT_THEME_ID, mode: "system" });
  // Clear LS after the setState so the subscriber's auto-LS-write does
  // not leak between tests. (Subscribers run synchronously inside
  // `setState`; the clear here is the per-test reset baseline.)
  localStorageMock.clear();
});

describe("AC-368-05 boot FOUC cache", () => {
  it("bootTheme() applies LS cache synchronously before any IPC", () => {
    // Previous boot persisted dark-mode + github theme into LS cache.
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );

    bootTheme();

    // First paint state — IPC not yet called, no async hop. The CSS
    // attribute pair must already be set so the browser doesn't paint
    // the default theme first.
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("silent SQLite truth update after boot does not visually jump (no transition)", () => {
    // LS cache says dark; SQLite truth (arrived later via snapshot hydrate
    // or state-changed event) is the same dark — store.setState is a no-op
    // from the data-* attribute standpoint.
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "dark" }),
    );
    bootTheme();
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");

    // Simulate snapshot hydrate arriving with same value.
    useThemeStore.setState({ themeId: "github", mode: "dark" });

    // Still dark — no flicker.
    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("github");
  });

  it("LS cache mismatch with SQLite truth — first paint is LS, silent update applies truth", () => {
    // LS cache says light; SQLite truth says dark (another window updated).
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "github", mode: "light" }),
    );

    bootTheme();
    // First paint reflects LS cache — fast and zero-IPC.
    expect(document.documentElement.getAttribute("data-mode")).toBe("light");

    // Snapshot IPC responds with the true dark mode. The store mutate
    // funnels through the subscriber's applyTheme, which sets the data-mode
    // attribute. CSS transitions on background-color / color are the
    // responsibility of the global stylesheet; the test cares only about
    // the data attribute synchronization.
    useThemeStore.setState({ themeId: "github", mode: "dark" });

    expect(document.documentElement.getAttribute("data-mode")).toBe("dark");
  });

  it("missing LS cache falls back to system resolution (still synchronous)", () => {
    // No LS entry — bootTheme uses default state. matchMedia returns
    // matches:false by default (test-setup mock) → "light".
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).toBeNull();

    bootTheme();

    expect(document.documentElement.getAttribute("data-mode")).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBeTruthy();
  });
});
