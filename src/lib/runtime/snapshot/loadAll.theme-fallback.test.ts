// Written 2026-05-16 — regression: unstyled first boot (theme).
//
// User report: the first boot rendered with broken styles; picking a theme by
// hand fixed it.
//
// Root cause: with no settings.theme row in SQLite, the backend returned
// `ThemeStore::default()` — `{theme_id: "default", mode: "system"}`.
// But the frontend `themeCatalog` has no `"default"` id (DEFAULT_THEME_ID
// === "slate"). The unsafe cast `slot.themeId as ThemeId` in `hydrateTheme`
// wrote `"default"` into the store as-is, a subscriber called
// `applyTheme("default", …)` → `data-theme="default"` landed on the DOM →
// themes.css has no such selector, so the `--tv-*` tokens were undefined →
// visibly "broken styles".
//
// Two invariants at this boundary (the cases below exercise the first):
//   1. An unknown themeId on the wire makes the frontend fall back to
//      `DEFAULT_THEME_ID` (= "slate") — keeping the store's themeId a valid
//      catalog id is the boundary's own responsibility.
//   2. An unknown mode likewise falls back to "system" (a branch that
//      already existed).

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { InitialAppState } from "@lib/tauri/snapshot";
import { DEFAULT_THEME_ID } from "@lib/themeCatalog";
import { useThemeStore } from "@stores/themeStore";
import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";

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
    connectionsRestoredFromBackup: false,
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
    // A valid mode passes through unchanged.
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
