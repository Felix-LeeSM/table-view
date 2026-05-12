/**
 * `workspaceStore` persistence axis. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors:
 *   - Mutations debounce-persist to `table-view-workspaces`.
 *   - `loadPersistedWorkspaces()` rehydrates the nested map.
 *   - Round-trip preserves (connId, db) keys and tab data; running query
 *     state collapses to idle (in-flight queries can't resume).
 *
 * Author intent (2026-05-12): vertical-slice persistence smoke. We rely
 * on `vi.useFakeTimers()` to drive the 200ms debounce deterministically,
 * mirroring `tabStore.persistence.test.ts` patterns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import {
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";
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

describe("workspaceStore — persistence", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it("debounce-persists workspaces under table-view-workspaces key, restored via loadPersistedWorkspaces", () => {
    useWorkspaceStore.getState().addTab("conn1", makeInit());
    vi.advanceTimersByTime(250);

    const raw = window.localStorage.getItem("table-view-workspaces");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as {
      workspaces: Record<string, Record<string, unknown>>;
    };
    expect(parsed.workspaces).toBeDefined();
    expect(parsed.workspaces["conn1"]).toBeDefined();
    expect(parsed.workspaces["conn1"]!["dbA"]).toBeDefined();

    useWorkspaceStore.setState({ workspaces: {} });
    expect(useWorkspaceStore.getState().workspaces).toEqual({});

    useWorkspaceStore.getState().loadPersistedWorkspaces();
    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect((ws!.tabs[0] as { table?: string }).table).toBe("users");
  });
});
