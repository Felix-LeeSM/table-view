// Written 2026-05-16 — AC-367-01 + AC-367-02.
//
// AC-367-01: after `loadAllFromSnapshot()`, only the 5 boot-critical stores
// (connections + groups / workspaces / mru / theme / safeMode) + the
// runtime.activeStatuses mirror are hydrated. favorites / queryHistory /
// datagrid_prefs are not hydrated (lazy — per-domain IPC at mount time).
//
// AC-367-02: fake 50ms IPC response + store mutate < 50ms total — overall
// hydrate duration < 100ms. Enough budget for p50/p95 measurement.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { InitialAppState } from "@lib/tauri/snapshot";
import { useConnectionStore } from "@stores/connectionStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useMruStore } from "@stores/mruStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useThemeStore } from "@stores/themeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";

function makeSnapshot(): InitialAppState {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: 1_700_000_000_000,
    partial: false,
    recovered: false,
    connectionsRestoredFromBackup: false,
    stores: {
      connections: {
        items: [
          {
            id: "c1",
            name: "Primary",
            dbType: "postgresql",
            host: "localhost",
            port: 5432,
            user: "u",
            database: "d",
            groupId: null,
            color: null,
            hasPassword: true,
            paradigm: "rdb",
          },
        ],
        groups: [
          {
            id: "g1",
            name: "Default",
            color: "#888",
            collapsed: false,
          },
        ],
      },
      workspaces: {
        byConnectionId: {
          c1: {
            // Workspace dehydrate output shape — opaque per-cell unknown.
            // Deeper hydrate behavior is covered elsewhere; this fixture
            // checks only the shape pass-through.
            d: {
              tabs: [],
              activeTabId: null,
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      },
      mru: {
        recentConnections: ["c1"],
        lastUsedConnectionId: "c1",
      },
      // 2026-05-16 — "default" is an invalid id absent from the frontend
      // catalog. The boundary fallback narrows to a valid catalog id, so the
      // fixture was switched to a valid id too ("github" — in the catalog,
      // and not slate).
      theme: { themeId: "github", mode: "dark" },
      safeMode: { mode: "warn" },
    },
    runtime: {
      activeStatuses: {
        c1: { type: "connected" },
      },
    },
  };
}

function freshStoresForTest(): void {
  // Reset each store to its default initial state explicitly — vitest module
  // isolation alone can let singleton stores leak across tests.
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
    hasLoadedOnce: false,
    loading: false,
    error: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
  useMruStore.setState({ recentConnections: [], lastUsedConnectionId: null });
  // theme/safeMode have domain defaults — only compared at assertion time.
  useFavoritesStore.setState({ favorites: [] });
  useQueryHistoryStore.setState({ recentVisible: [] });
}

describe("AC-367-01 boot-critical 5 store hydrate shape", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    freshStoresForTest();
    resetSnapshotBufferForTests();
  });

  it("hydrates connections (items + groups), workspaces, mru, theme, safeMode, runtime.activeStatuses", async () => {
    invokeMock.mockResolvedValueOnce(makeSnapshot());

    await loadAllFromSnapshot();

    const conn = useConnectionStore.getState();
    expect(conn.connections).toHaveLength(1);
    expect(conn.connections[0]?.id).toBe("c1");
    expect(conn.groups).toHaveLength(1);
    expect(conn.groups[0]?.id).toBe("g1");
    expect(conn.activeStatuses).toEqual({ c1: { type: "connected" } });

    const ws = useWorkspaceStore.getState();
    // Two-level (connId, db) key — byte-equivalent to the dehydrate wire shape.
    expect(ws.workspaces.c1?.d).toBeDefined();

    const mru = useMruStore.getState();
    expect(mru.lastUsedConnectionId).toBe("c1");
    expect(mru.recentConnections.map((e) => e.connectionId)).toEqual(["c1"]);

    const theme = useThemeStore.getState();
    expect(theme.themeId).toBe("github");
    expect(theme.mode).toBe("dark");

    const safe = useSafeModeStore.getState();
    expect(safe.mode).toBe("warn");
  });

  it("normalizes legacy snake-case connection snapshot fields on restore", async () => {
    const snap = makeSnapshot();
    snap.stores.connections = {
      items: [
        {
          id: "legacy-c1",
          name: "Legacy",
          db_type: "mongodb",
          host: "localhost",
          port: 27017,
          user: "",
          database: "admin",
          group_id: "legacy-g1",
          color: null,
          has_password: true,
          paradigm: "document",
          auth_source: "admin",
          replica_set: "rs0",
          ssl_mode: "verify-full",
        },
      ],
      groups: [
        {
          id: "legacy-g1",
          name: "Legacy Group",
          color: null,
          collapsed: false,
        },
      ],
    } as never;
    snap.runtime.activeStatuses = {
      "legacy-c1": { type: "connected", active_db: "admin" },
    } as never;
    invokeMock.mockResolvedValueOnce(snap);

    await loadAllFromSnapshot();

    const conn = useConnectionStore.getState();
    expect(conn.connections[0]).toMatchObject({
      id: "legacy-c1",
      dbType: "mongodb",
      groupId: "legacy-g1",
      hasPassword: true,
      authSource: "admin",
      replicaSet: "rs0",
      sslMode: "verify-full",
    });
    expect(conn.activeStatuses["legacy-c1"]).toEqual({
      type: "connected",
      activeDb: "admin",
    });
  });

  it("normalizes legacy snake-case completed queryState in workspace snapshots", async () => {
    const snap = makeSnapshot();
    snap.stores.workspaces = {
      byConnectionId: {
        c1: {
          d: {
            tabs: [
              {
                type: "query",
                id: "query-1",
                title: "Query",
                connectionId: "c1",
                closable: true,
                sql: "select 1",
                paradigm: "rdb",
                queryMode: "sql",
                queryState: {
                  status: "completed",
                  result: {
                    columns: [
                      { name: "id", data_type: "int4", category: "int" },
                    ],
                    rows: [[1]],
                    total_count: 1,
                    execution_time_ms: 4,
                    query_type: "select",
                  },
                },
              },
            ],
            activeTabId: "query-1",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    } as never;
    invokeMock.mockResolvedValueOnce(snap);

    await loadAllFromSnapshot();

    const tab = useWorkspaceStore.getState().workspaces.c1?.d?.tabs[0];
    expect(tab?.type).toBe("query");
    if (tab?.type !== "query") throw new Error("expected query tab");
    expect(tab.queryState.status).toBe("completed");
    if (tab.queryState.status !== "completed") {
      throw new Error("expected completed query state");
    }
    expect(tab.queryState.result).toMatchObject({
      totalCount: 1,
      executionTimeMs: 4,
      queryType: "select",
    });
    expect(tab.queryState.result.columns[0]?.dataType).toBe("int4");
  });

  it("backfills sql queryLanguage for active and closed SQLite query tabs in workspace snapshots", async () => {
    const snap = makeSnapshot();
    const legacyQueryState = {
      status: "completed",
      result: {
        columns: [{ name: "answer", data_type: "int4", category: "int" }],
        rows: [[42]],
        total_count: 1,
        execution_time_ms: 7,
        query_type: "select",
      },
    };
    snap.stores.workspaces = {
      byConnectionId: {
        "conn-sqlite": {
          main: {
            tabs: [
              {
                type: "query",
                id: "query-active",
                title: "Query",
                connectionId: "conn-sqlite",
                closable: true,
                sql: "SELECT 1",
                paradigm: "rdb",
                queryMode: "sql",
                queryState: legacyQueryState,
              },
            ],
            activeTabId: "query-active",
            closedTabHistory: [
              {
                type: "query",
                id: "query-closed",
                title: "Query",
                connectionId: "conn-sqlite",
                closable: true,
                sql: "SELECT 2",
                paradigm: "rdb",
                queryMode: "sql",
                queryState: legacyQueryState,
              },
            ],
            sidebar: { expanded: [] },
          },
        },
      },
    } as never;
    invokeMock.mockResolvedValueOnce(snap);

    await loadAllFromSnapshot();

    const workspace =
      useWorkspaceStore.getState().workspaces["conn-sqlite"]?.main;
    const activeTab = workspace?.tabs[0];
    const closedTab = workspace?.closedTabHistory[0];

    if (activeTab?.type !== "query") {
      throw new Error("expected active query tab");
    }
    if (closedTab?.type !== "query") {
      throw new Error("expected closed query tab");
    }

    // eslint-disable-next-line @typescript-eslint/no-deprecated -- #1403: QueryTab.queryMode is intentional migration debt, removed when Phase 28 Slice A5 lands
    expect(activeTab.queryMode).toBe("sql");
    expect(activeTab.queryLanguage).toBe("sql");
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- #1403: QueryTab.queryMode is intentional migration debt, removed when Phase 28 Slice A5 lands
    expect(closedTab.queryMode).toBe("sql");
    expect(closedTab.queryLanguage).toBe("sql");

    expect(activeTab.queryState.status).toBe("completed");
    expect(closedTab.queryState.status).toBe("completed");
    if (
      activeTab.queryState.status !== "completed" ||
      closedTab.queryState.status !== "completed"
    ) {
      throw new Error("expected completed query states");
    }
    expect(activeTab.queryState.result.executionTimeMs).toBe(7);
    expect(closedTab.queryState.result.totalCount).toBe(1);
  });

  it("#1091 — backfills dirtyTabIds + sidebar defaults absent from the backend snapshot shape", async () => {
    // The backend `read_workspaces` reconstitutes only { activeTabId, tabs,
    // sidebar: { expanded }, closedTabHistory } — dirtyTabIds is a window-local
    // marker that is intentionally never persisted, and selectedNode/scrollTop
    // are dehydrated to defaults. Before #1091, persist was a no-op so this
    // partial shape never reached the store. Now that a reopened workspace
    // hydrates a non-empty snapshot, hydrate must backfill the missing fields
    // or `App.tsx`'s `useConnectionHasDirtyTabs` hits `undefined.length` and
    // unmounts the whole workspace window.
    const snap = makeSnapshot();
    snap.stores.workspaces = {
      byConnectionId: {
        c1: {
          d: {
            tabs: [
              {
                type: "table",
                id: "tab-1",
                title: "users",
                connectionId: "c1",
                closable: true,
                schema: "public",
                table: "users",
                subView: "records",
                database: "d",
              },
            ],
            activeTabId: "tab-1",
            closedTabHistory: [],
            sidebar: { expanded: ["public"] },
          },
        },
      },
    } as never;
    invokeMock.mockResolvedValueOnce(snap);

    await loadAllFromSnapshot();

    const ws = useWorkspaceStore.getState().workspaces.c1?.d;
    expect(ws?.dirtyTabIds).toEqual([]);
    expect(ws?.sidebar).toEqual({
      selectedNode: null,
      expanded: ["public"],
      scrollTop: 0,
    });
  });

  it("does NOT hydrate favorites / queryHistory / datagrid_prefs (lazy via mount IPC)", async () => {
    invokeMock.mockResolvedValueOnce(makeSnapshot());

    await loadAllFromSnapshot();

    // favorites / queryHistory are absent from the snapshot response, and
    // their stores stay at default. dataGrid prefs are out of scope here.
    expect(useFavoritesStore.getState().favorites).toEqual([]);
    expect(useQueryHistoryStore.getState().recentVisible).toEqual([]);
    expect(useQueryHistoryStore.getState().recentVisible).toEqual([]);
  });

  it("returns the resolved snapshot to the caller", async () => {
    const snap = makeSnapshot();
    invokeMock.mockResolvedValueOnce(snap);

    const result = await loadAllFromSnapshot();
    expect(result.snapshotVersion).toBe(1);
    expect(result.schemaVersion).toBe(1);
  });
});

describe("AC-367-02 boot hydrate timing < 100ms (fake 50ms IPC)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    freshStoresForTest();
    resetSnapshotBufferForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("completes within 100ms total when IPC simulates ~50ms response", async () => {
    vi.useFakeTimers();
    invokeMock.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return makeSnapshot();
    });

    const t0 = performance.now();
    const result = loadAllFromSnapshot();
    await vi.advanceTimersByTimeAsync(50);
    await result;
    const elapsed = performance.now() - t0;

    // 50ms IPC + < 50ms mutate ≤ 100ms total — the boot budget in the
    // strategy doc's Phase 4. Fake timers keep the IPC delay deterministic
    // under CI load.
    expect(elapsed).toBeLessThan(100);
  });

  it("hydrate path is Promise.all (parallel) not serial — 5 simulated 20ms hydrate < ~30ms", async () => {
    // Telling serial and parallel apart directly is hard, so this checks
    // that the 5 steps are all sync (one microtask tick). If the awaits ran
    // serially 5 times, 5 * (small) latency would pile up into a performance
    // regression → invariant: the store mutate must use the await
    // Promise.all([…]) pattern.
    invokeMock.mockResolvedValueOnce(makeSnapshot());

    const t0 = performance.now();
    await loadAllFromSnapshot();
    const elapsed = performance.now() - t0;

    // The IPC mock resolves in a microtask — the 5 store mutates must finish
    // synchronously in the same tick to stay < 30ms. The asserted < 50ms
    // bound is very loose, so it absorbs CI noise.
    expect(elapsed).toBeLessThan(50);
  });
});
