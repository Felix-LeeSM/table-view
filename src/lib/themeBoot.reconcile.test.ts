/**
 * 작성 2026-05-17 (Wave 9.5 회귀 7 진짜 fix — boot-time backend reconcile)
 *
 * 사용자 시나리오 (회귀 7 의 두 번째 root cause):
 *   1. launcher 에서 theme="github" 으로 변경 → SQLite write (optimistic IPC)
 *   2. workspace-{conn_id} 가 새로 열림 — Tauri 2 webview 는 각자 별도의
 *      localStorage. workspace 의 LS 는 비어있음.
 *   3. workspace 의 `bootTheme()` (LS fast path) → DEFAULT_THEME_ID ("slate")
 *      로 첫 paint = "slate flash"
 *   4. snapshot async hydrate 가 도착하면 update 되지만 그 사이 사용자가
 *      슬레이트 색을 본다 → "창 단위로 적용된다" 보고
 *
 * fix: `reconcileThemeFromBackend()` 가 backend `get_setting("theme")` 으로
 * SQLite truth 를 읽고 LS / DOM 을 갱신. main.tsx 의 boot 가 await 하여 첫
 * React render 전에 정답값 도달. 본 test 는 그 invariant 들을 lock:
 *
 *   - SQLite 가 LS 와 다른 값 보유 → DOM data-theme 가 SQLite 값으로 변경.
 *   - SQLite 가 LS 와 다른 값 보유 → LS 가 SQLite 값으로 덮어쓰임 (다음 boot 의
 *     FOUC 캐시 일관성).
 *   - SQLite 와 LS 가 일치 → DOM/LS no-op (불필요 write 없음).
 *   - get_setting 이 null (첫 boot, 아직 settings 없음) → no-op.
 *   - IPC throw (Tauri 없는 환경) → graceful fallback, throw 안 함.
 *   - SQLite 값 malformed → no-op, throw 안 함.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  reconcileThemeFromBackend,
  readStoredState,
  THEME_STORAGE_KEY,
  DEFAULT_THEME_ID,
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
    // 새 webview boot 시뮬레이션: LS 비어있어서 DEFAULT (slate) 로 페인트됨.
    // 그 사이 SQLite 에는 launcher 에서 저장한 "github" 가 있음.
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
    // LS 에 이미 "vercel/dark" 가 있음 (이전 boot 이 저장).
    localStorageMock.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({ themeId: "vercel", mode: "dark" }),
    );
    const lsBefore = localStorageMock.getItem(THEME_STORAGE_KEY);
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "vercel", mode: "dark" }),
    );

    await reconcileThemeFromBackend();

    // LS 의 raw string 자체가 그대로 (불필요한 re-stringify write 없음 보장).
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).toBe(lsBefore);
  });

  it("get_setting 이 null (첫 boot, settings 없음) 이면 no-op", async () => {
    invokeMock.mockResolvedValueOnce(null);
    document.documentElement.setAttribute("data-theme", DEFAULT_THEME_ID);
    document.documentElement.setAttribute("data-mode", "light");

    await reconcileThemeFromBackend();

    // DOM 그대로 — bootTheme 가 적용한 fast-path 값 유지.
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
    // LS 변경 없음.
    expect(localStorageMock.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("SQLite 값이 unknown themeId 면 no-op (catalog 에 없는 id 로 DOM 오염 회피)", async () => {
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({ themeId: "no-such-theme", mode: "dark" }),
    );

    await reconcileThemeFromBackend();

    // unknown id 로 DOM 오염 안 됨.
    expect(document.documentElement.getAttribute("data-theme")).not.toBe(
      "no-such-theme",
    );
  });
});
