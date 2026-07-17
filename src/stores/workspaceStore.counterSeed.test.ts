/**
 * `workspaceStore` counter seed axis. 작성 2026-05-16 (Phase 0 sprint-354).
 *
 * 사유: state-management-strategy M-2 fix — `tabCounter` / `queryCounter`
 * 는 boot 시 0 으로 시작하므로 persisted id 와 충돌 가능. 본 테스트는
 * `loadPersistedWorkspaces` 가 모든 workspace 의 tab/query id 를 scan 해
 * `Math.max(persisted ids) + 1` 로 counter 를 seed 함을 고정한다.
 *
 * Public-surface only: `loadPersistedWorkspaces()` → `addTab` / `addQueryTab`
 * 새 id. 내부 module-scope counter 변수 read 는 의도적으로 회피
 * (testing scenarios 원칙 — 동작 검증, 모양 검증 X).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetCountersForTests, useWorkspaceStore } from "./workspaceStore";
import {
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";
import { STORAGE_KEY } from "./workspaceStore/persistence";
import type { TableTab, QueryTab } from "./workspaceStore/types";
import type { ConnectionId, TabId } from "@/types/branded";

function makeTableTab(id: string): TableTab {
  return {
    type: "table",
    id: id as TabId,
    title: id,
    connectionId: "conn1" as ConnectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    database: "dbA",
  };
}

function makeQueryTab(id: string): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: id,
    connectionId: "conn1" as ConnectionId,
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" as const },
    paradigm: "rdb",
    queryMode: "sql",
    database: "dbA",
  };
}

describe("workspaceStore — counter seed (M-2 fix)", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
    __resetCountersForTests();
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  it("AC-354-01 — 5 persisted tabs (tab-1, tab-3, tab-7, tab-10, tab-12) seed tabCounter to 12; next addTab assigns tab-13", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspaces: {
          conn1: {
            dbA: {
              tabs: [
                makeTableTab("tab-1"),
                makeTableTab("tab-3"),
                makeTableTab("tab-7"),
                makeTableTab("tab-10"),
                makeTableTab("tab-12"),
              ],
              activeTabId: "tab-12",
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      }),
    );

    useWorkspaceStore.getState().loadPersistedWorkspaces();

    // Add a new tab to a workspace without a preview slot collision.
    // Use a different db / table to avoid preview-slot reuse semantics.
    useWorkspaceStore.getState().addTab("conn1", {
      type: "table",
      title: "fresh",
      connectionId: "conn1" as ConnectionId,
      closable: true,
      schema: "public",
      table: "fresh",
      subView: "records",
      database: "dbB",
      permanent: true,
    });

    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbB"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect(ws!.tabs[0]!.id).toBe("tab-13");
  });

  it("AC-354-03 — empty persisted workspaces keep counters at default; first addTab → tab-1 and first addQueryTab → query-1", () => {
    // No STORAGE_KEY entry — boot path with nothing persisted. The
    // counters must not advance past 0 from a no-op load.
    useWorkspaceStore.getState().loadPersistedWorkspaces();

    useWorkspaceStore.getState().addTab("conn1", {
      type: "table",
      title: "users",
      connectionId: "conn1" as ConnectionId,
      closable: true,
      schema: "public",
      table: "users",
      subView: "records",
      database: "dbA",
      permanent: true,
    });

    let ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect(ws!.tabs[0]!.id).toBe("tab-1");

    useWorkspaceStore.getState().addQueryTab("conn1", "dbA", {
      paradigm: "rdb",
      queryMode: "sql",
      database: "dbA",
    });

    ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(2);
    expect(ws!.tabs[1]!.id).toBe("query-1");
  });

  it("#1091 — hydrateWorkspacesFromSnapshot (real boot path) seeds counters so restored ids never collide", () => {
    // The production boot path is snapshot IPC → hydrateWorkspacesFromSnapshot,
    // NOT the legacy-LS loadPersistedWorkspaces. Before #1091 that path never
    // seeded the counters, so a restored workspace holding tab-1..tab-3 with
    // tabCounter=0 re-issued tab-1 on the next addTab → duplicate id (React
    // key collision + removeTab filter dropping both same-id tabs).
    useWorkspaceStore.getState().hydrateWorkspacesFromSnapshot({
      conn1: {
        dbA: {
          tabs: [
            makeTableTab("tab-1"),
            makeTableTab("tab-2"),
            makeTableTab("tab-3"),
          ],
          activeTabId: "tab-3",
          closedTabHistory: [],
          dirtyTabIds: [],
          sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
        },
      },
    });

    useWorkspaceStore.getState().addTab("conn1", {
      type: "table",
      title: "fresh",
      connectionId: "conn1" as ConnectionId,
      closable: true,
      schema: "public",
      table: "fresh",
      subView: "records",
      database: "dbA",
      permanent: true,
    });

    const tabs =
      useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"]?.tabs;
    expect(tabs).toBeDefined();
    const ids = tabs!.map((t) => t.id);
    // No id collision — every tab id is unique.
    expect(new Set(ids).size).toBe(ids.length);
    // Freshly added tab is tab-4 (max persisted + 1), not a re-issued tab-1.
    expect(ids[ids.length - 1]).toBe("tab-4");
  });

  it("AC-354-02 — persisted query tabs (query-2, query-5, query-9) seed queryCounter; next addQueryTab assigns query-10", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspaces: {
          conn1: {
            dbA: {
              tabs: [
                makeQueryTab("query-2"),
                makeQueryTab("query-5"),
                makeQueryTab("query-9"),
              ],
              activeTabId: "query-9",
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      }),
    );

    useWorkspaceStore.getState().loadPersistedWorkspaces();

    useWorkspaceStore.getState().addQueryTab("conn1", "dbA", {
      paradigm: "rdb",
      queryMode: "sql",
      database: "dbA",
    });

    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    // 3 persisted + 1 new = 4 tabs.
    expect(ws!.tabs).toHaveLength(4);
    // The new query tab is appended; its id should be query-10 (max + 1).
    expect(ws!.tabs[ws!.tabs.length - 1]!.id).toBe("query-10");
  });
});
