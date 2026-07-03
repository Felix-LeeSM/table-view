/**
 * `workspaceStore` selector hooks. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors:
 *   - `useCurrentWorkspaceKey()` derives `(connId, db)` from the Tauri
 *     window label (`workspace-{connection_id}` → `connId`,
 *     sprint-366 Phase 4 Q15) plus
 *     `connectionStore.activeStatuses[connId].activeDb`. Returns `null`
 *     when no window conn (launcher / jsdom) or no active DB.
 *   - `useCurrentWorkspace()` returns the matching `WorkspaceState` or
 *     `null` when the (connId, db) tuple has no entry (lazy create —
 *     entry exists only after first write).
 *
 * Author intent (2026-05-12): lazy-create invariant has to hold at the
 * read seam too — a fresh launch (no writes yet) must return null, not
 * an auto-seeded empty workspace.
 *
 * sprint-366 update (2026-05-16): `connId` now comes from the window
 * label via `useCurrentWindowConnectionId()`. Tests stub the label with
 * `setFakeWindowConnectionId()` instead of seeding
 * `connectionStore.focusedConnId`.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(),
  };
});

import { useConnectionStore } from "./connectionStore";
import {
  useConnectionHasDirtyTabs,
  useCurrentWorkspace,
  useCurrentWorkspaceKey,
  useWorkspaceStore,
  type WorkspaceState,
} from "./workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "./__tests__/fakeWindowConnectionId";
import type { TableTabInit } from "./workspaceStore/types";

function makeInit(overrides: Partial<TableTabInit> = {}): TableTabInit {
  return {
    type: "table",
    title: "users",
    connectionId: "conn1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    database: "dbA",
    ...overrides,
  };
}

describe("workspaceStore — selectors", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      activeStatuses: {},
      focusedConnId: null,
    });
    setFakeWindowConnectionId(null);
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  it("useCurrentWorkspaceKey — null when no window connection (launcher / jsdom)", () => {
    // 사유 (2026-05-16, sprint-366): pre-sprint-366 nullable signal was
    // `focusedConnId === null`; post-sprint-366 it is the window label
    // hook returning null (launcher window or jsdom with no Tauri seam).
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toBeNull();
  });

  it("useCurrentWorkspaceKey — derives (connId, db) from window label + activeStatuses", () => {
    // 사유 (2026-05-16, sprint-366): label `workspace-conn1` → conn1.
    setFakeWindowConnectionId("conn1");
    useConnectionStore.setState({
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "conn1", db: "dbA" });
  });

  it("useCurrentWorkspaceKey — null when window has a connId but activeDb missing", () => {
    // 사유 (2026-05-16, sprint-366): contract — both halves required.
    // Window says "conn1" but the status is missing / disconnected → null.
    setFakeWindowConnectionId("conn1");
    useConnectionStore.setState({
      activeStatuses: {},
    });
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toBeNull();
  });

  it("useCurrentWorkspaceKey — ignores connectionStore.focusedConnId (Q15 lock)", () => {
    // 사유 (2026-05-16, sprint-366): regression guard — if a future change
    // accidentally re-reads `state.focusedConnId`, this test fails because
    // the connectionStore slot points at "c-bait" while the window label
    // says "c-real". Q15 lock requires the window label to win.
    setFakeWindowConnectionId("c-real");
    useConnectionStore.setState({
      focusedConnId: "c-bait",
      activeStatuses: {
        "c-real": { type: "connected", activeDb: "db-real" },
        "c-bait": { type: "connected", activeDb: "db-bait" },
      },
    });
    const { result } = renderHook(() => useCurrentWorkspaceKey());
    expect(result.current).toEqual({ connId: "c-real", db: "db-real" });
  });

  it("useCurrentWorkspace — null when key resolves but no entry written yet (lazy)", () => {
    setFakeWindowConnectionId("conn1");
    useConnectionStore.setState({
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    const { result } = renderHook(() => useCurrentWorkspace());
    expect(result.current).toBeNull();
  });

  it("useCurrentWorkspace — returns the entry after a write", () => {
    setFakeWindowConnectionId("conn1");
    useConnectionStore.setState({
      activeStatuses: { conn1: { type: "connected", activeDb: "dbA" } },
    });
    useWorkspaceStore.getState().addTab("conn1", makeInit());

    const { result } = renderHook(() => useCurrentWorkspace());
    expect(result.current).not.toBeNull();
    expect(result.current!.tabs).toHaveLength(1);
  });

  it("#1091 — useConnectionHasDirtyTabs tolerates a hydrated workspace with no dirtyTabIds", () => {
    // App.tsx's top-level `useConnectionHasDirtyTabs(currentConnId)` runs on
    // every workspace-window render. A boot-hydrated workspace omits the
    // window-local `dirtyTabIds` marker (it is never persisted), so reading
    // `ws.dirtyTabIds.length` on the raw hydrate shape threw and unmounted the
    // whole workspace window (#1091 reopen crash — root left empty). Seed the
    // store with that exact partial shape and assert the selector is safe.
    useWorkspaceStore.setState({
      workspaces: {
        conn1: {
          dbA: {
            activeTabId: "tab-1",
            tabs: [
              {
                type: "table",
                id: "tab-1",
                title: "users",
                connectionId: "conn1",
                closable: true,
                subView: "records",
                database: "dbA",
              },
            ],
            closedTabHistory: [],
            sidebar: { expanded: [] },
          } as unknown as WorkspaceState,
        },
      },
    });

    const { result } = renderHook(() => useConnectionHasDirtyTabs("conn1"));
    expect(result.current).toBe(false);
  });
});
