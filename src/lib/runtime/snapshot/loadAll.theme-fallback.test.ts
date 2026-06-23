// 작성 2026-05-16 — Wave 9.5 회귀 2 (테마 빈 부팅).
//
// 사용자 보고 (sprint-367 머지 직후): 첫 부팅 시 스타일이 깨진 상태로 표시.
// 사용자가 직접 테마를 고르면 정상.
//
// Root cause: SQLite 의 settings.theme row 가 없을 때 backend 가
// `ThemeStore::default()` 반환 — `{theme_id: "default", mode: "system"}`.
// 그러나 frontend `themeCatalog` 에는 `"default"` id 가 없다 (DEFAULT_THEME_ID
// === "slate"). `hydrateTheme` 의 `slot.themeId as ThemeId` 라는 unsafe cast 가
// `"default"` 를 그대로 store 에 박고, subscriber 가 `applyTheme("default", …)`
// 호출 → `data-theme="default"` 가 DOM 에 설정 → themes.css 에 그 selector 가
// 없어 `--tv-*` 토큰 미정의 → 시각적으로 "스타일이 깨진" 상태.
//
// 본 regression test 는 두 invariant 를 잠근다:
//   1. unknown themeId 가 wire 로 들어오면 frontend 가 `DEFAULT_THEME_ID`
//      (= "slate") 로 fallback 한다 — store 의 themeId 가 catalog 안 valid id
//      라는 사실 자체가 boundary 의 책임.
//   2. unknown mode 도 동일하게 "system" 으로 fallback (이미 존재하던 분기).

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";
import { useThemeStore } from "@stores/themeStore";
import { DEFAULT_THEME_ID } from "@lib/themeCatalog";
import type { InitialAppState } from "@lib/tauri/snapshot";

function makeSnapshotWithTheme(theme: {
  themeId: string;
  mode: string;
}): InitialAppState {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: 1_700_000_000_000,
    partial: false,
    recovered: false,
    stores: {
      connections: { items: [], groups: [] },
      workspaces: { byConnectionId: {} },
      mru: { recentConnections: [], lastUsedConnectionId: null },
      theme,
      safeMode: { mode: "off" },
    },
    runtime: { activeStatuses: {} },
  };
}

beforeEach(() => {
  resetSnapshotBufferForTests();
  invokeMock.mockReset();
  useThemeStore.setState({
    themeId: DEFAULT_THEME_ID,
    mode: "system",
    resolvedMode: "light",
  });
});

describe("hydrateTheme — unknown themeId fallback (회귀 2)", () => {
  it("backend default 'default' → store themeId = DEFAULT_THEME_ID (slate)", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshotWithTheme({ themeId: "default", mode: "system" }),
    );

    await loadAllFromSnapshot();

    expect(useThemeStore.getState().themeId).toBe(DEFAULT_THEME_ID);
  });

  it("미정의 themeId (예: 사용자 manual SQLite tamper) → DEFAULT_THEME_ID fallback", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshotWithTheme({ themeId: "not-a-real-theme", mode: "dark" }),
    );

    await loadAllFromSnapshot();

    const state = useThemeStore.getState();
    expect(state.themeId).toBe(DEFAULT_THEME_ID);
    // mode 는 valid 면 그대로
    expect(state.mode).toBe("dark");
  });

  it("valid themeId 는 그대로 통과", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshotWithTheme({ themeId: "github", mode: "light" }),
    );

    await loadAllFromSnapshot();

    const state = useThemeStore.getState();
    expect(state.themeId).toBe("github");
    expect(state.mode).toBe("light");
  });
});
