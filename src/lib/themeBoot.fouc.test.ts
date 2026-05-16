/**
 * 작성 2026-05-16 (Phase 4 sprint-368, AC-368-05)
 *
 * 사유: Q12 FOUC 0 invariant — boot 시 LS `table-view-theme` cache 가
 * SQLite truth 와 일시 불일치할 수 있다 (e.g. 다른 window 에서 변경 후 본
 * window 가 아직 listener 통해 못 받음). 첫 paint 는 반드시 LS cache 값으로
 * 즉시 적용돼야 visible flash 가 없다. SQLite truth 는 snapshot IPC 응답 후
 * silent 갱신.
 *
 * 본 jsdom 테스트는 다음 시퀀스를 검증한다:
 *   1. LS 에 `{themeId:"github", mode:"light"}` 가 적힘 (이전 boot 의 마지막 success)
 *   2. `bootTheme()` 호출 직후 (sync) document.documentElement 의 `data-mode`
 *      가 "light" 로 설정됨 — IPC 응답 미수신
 *   3. 향후 sprint-367 snapshot 이 `mode:"dark"` 를 가져오면 silent 갱신
 *      (시뮬은 `useThemeStore.setState` 호출)
 *
 * 회귀 시: LS read 사이트가 사라져 첫 paint 가 default (system) 으로 시작 →
 * dark 모드 사용자 화면이 light flash → 즉시 dark 로 바뀜.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { bootTheme, THEME_STORAGE_KEY, DEFAULT_THEME_ID } from "@lib/themeBoot";
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
