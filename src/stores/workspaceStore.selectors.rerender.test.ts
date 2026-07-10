/**
 * #1447 — keystroke re-render regression guard.
 *
 * `updateQuerySql` fires on every SQL editor keystroke. Components that do
 * not consume the sql text (TabBar / App / SchemaTree / DbSwitcher /
 * WorkspaceSidebar) must not re-render on it. Pre-#1447 every derived
 * selector hook composed `useCurrentWorkspace()` — a whole-`WorkspaceState`
 * subscription — so a single keystroke re-rendered all of them.
 *
 * Behaviors locked here:
 *   1. sql-free hooks (`useActiveTabId` / `useDirtyTabIds` /
 *      `useClosedTabHistory` / `useActiveTabSansSql` / `useCurrentTabIds`)
 *      do NOT re-render on a keystroke sql update.
 *   2. `updateQuerySql` keeps reference stability: untouched tabs and the
 *      sql-free workspace fields keep their identity (AC1), and a same-sql
 *      write is a no-op state-wise.
 *   3. `useActiveTabSansSql` still exposes the non-sql tab fields and
 *      reacts to a real tab switch.
 */
import { act, renderHook } from "@testing-library/react";
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
  __resetCountersForTests,
  useActiveTabId,
  useActiveTabSansSql,
  useClosedTabHistory,
  useCurrentTabIds,
  useCurrentTabs,
  useDirtyTabIds,
  useWorkspaceStore,
} from "./workspaceStore";
import {
  resetFakeWindowConnectionId,
  setFakeWindowConnectionId,
} from "./__tests__/fakeWindowConnectionId";

const CONN = "conn1";
const DB = "dbA";

/** renderHook wrapper that counts how many times the hook body ran. */
function probe<T>(hook: () => T) {
  let renders = 0;
  const view = renderHook(() => {
    renders += 1;
    return hook();
  });
  return { view, renders: () => renders };
}

function getWs() {
  const ws = useWorkspaceStore.getState().workspaces[CONN]?.[DB];
  if (!ws) throw new Error("workspace not seeded");
  return ws;
}

function seedTwoQueryTabs(): { activeId: string; otherId: string } {
  const store = useWorkspaceStore.getState();
  store.addQueryTab(CONN, DB, { paradigm: "rdb" });
  store.addQueryTab(CONN, DB, { paradigm: "rdb" });
  const ws = getWs();
  const activeId = ws.activeTabId!;
  const otherId = ws.tabs.find((t) => t.id !== activeId)!.id;
  return { activeId, otherId };
}

describe("workspaceStore — #1447 keystroke re-render guard", () => {
  beforeEach(() => {
    __resetCountersForTests();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      activeStatuses: { [CONN]: { type: "connected", activeDb: DB } },
      focusedConnId: null,
    });
    setFakeWindowConnectionId(CONN);
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
  });

  it("sql-free selector hooks do not re-render on a keystroke sql update", () => {
    const { activeId } = seedTwoQueryTabs();

    const activeTabId = probe(() => useActiveTabId());
    const dirtyTabIds = probe(() => useDirtyTabIds());
    const closedHistory = probe(() => useClosedTabHistory());
    const activeTabSansSql = probe(() => useActiveTabSansSql());
    const tabIds = probe(() => useCurrentTabIds());
    // Positive control — proves the probes detect re-renders at all: the
    // tabs array itself legitimately changes on every sql write.
    const tabsControl = probe(() => useCurrentTabs());

    expect(activeTabId.renders()).toBe(1);

    act(() => {
      useWorkspaceStore.getState().updateQuerySql(CONN, DB, activeId, "sel");
    });
    act(() => {
      useWorkspaceStore.getState().updateQuerySql(CONN, DB, activeId, "sele");
    });

    expect(tabsControl.renders()).toBeGreaterThan(1);
    expect(activeTabId.renders()).toBe(1);
    expect(dirtyTabIds.renders()).toBe(1);
    expect(closedHistory.renders()).toBe(1);
    expect(activeTabSansSql.renders()).toBe(1);
    expect(tabIds.renders()).toBe(1);

    // The keystroke still landed (기능 계약): the store sql is updated.
    const tab = getWs().tabs.find((t) => t.id === activeId)!;
    expect(tab.type === "query" && tab.sql).toBe("sele");
  });

  it("updateQuerySql keeps untouched tabs and sql-free workspace fields reference-stable (AC1)", () => {
    const { activeId, otherId } = seedTwoQueryTabs();
    const before = getWs();
    const otherBefore = before.tabs.find((t) => t.id === otherId)!;

    useWorkspaceStore.getState().updateQuerySql(CONN, DB, activeId, "select 1");

    const after = getWs();
    expect(after).not.toBe(before); // the edit itself did land
    expect(after.tabs.find((t) => t.id === otherId)).toBe(otherBefore);
    expect(after.activeTabId).toBe(before.activeTabId);
    expect(after.dirtyTabIds).toBe(before.dirtyTabIds);
    expect(after.closedTabHistory).toBe(before.closedTabHistory);
    expect(after.sidebar).toBe(before.sidebar);
  });

  it("updateQuerySql with identical sql is a state no-op", () => {
    const { activeId } = seedTwoQueryTabs();
    useWorkspaceStore.getState().updateQuerySql(CONN, DB, activeId, "select 1");
    const before = useWorkspaceStore.getState().workspaces;

    useWorkspaceStore.getState().updateQuerySql(CONN, DB, activeId, "select 1");

    expect(useWorkspaceStore.getState().workspaces).toBe(before);
  });

  it("useActiveTabSansSql exposes non-sql fields and reacts to a tab switch", () => {
    const { activeId, otherId } = seedTwoQueryTabs();

    const { view, renders } = probe(() => useActiveTabSansSql());
    expect(view.result.current).toMatchObject({
      type: "query",
      id: activeId,
      connectionId: CONN,
    });
    expect(view.result.current).not.toHaveProperty("sql");

    act(() => {
      useWorkspaceStore.getState().setActiveTab(CONN, DB, otherId);
    });

    expect(renders()).toBe(2);
    expect(view.result.current?.id).toBe(otherId);
  });

  it("useCurrentTabIds reflects tab order and reacts to add/remove", () => {
    const { activeId, otherId } = seedTwoQueryTabs();

    const { view } = probe(() => useCurrentTabIds());
    // seed order: first-added tab first, active (second-added) last.
    expect(view.result.current).toEqual([otherId, activeId]);

    act(() => {
      useWorkspaceStore.getState().removeTab(CONN, DB, otherId);
    });
    expect(view.result.current).toEqual([activeId]);
  });
});
