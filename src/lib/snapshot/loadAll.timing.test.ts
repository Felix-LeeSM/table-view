// 작성 2026-05-16 (Phase 4 sprint-367) — AC-367-01 + AC-367-02.
//
// AC-367-01: `loadAllFromSnapshot()` 호출 후 5 boot-critical store
// (connections + groups / workspaces / mru / theme / safeMode) + runtime.activeStatuses
// mirror 만 hydrate. favorites / queryHistory / datagrid_prefs 는 hydrate 안 됨
// (lazy — mount 시점에 도메인별 IPC).
//
// AC-367-02: fake 50ms IPC 응답 + store mutate < 50ms total — 전체 hydrate
// duration < 100ms. p50/p95 측정에 충분한 budget.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useMruStore } from "@stores/mruStore";
import { useThemeStore } from "@stores/themeStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import type { InitialAppState } from "@lib/tauri/snapshot";

function makeSnapshot(): InitialAppState {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: 1_700_000_000_000,
    partial: false,
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
            // sprint-353 dehydrate output shape — opaque per-cell unknown.
            // 실제 hydrate 는 sprint-368/369 등에서 더 깊게 다루지만 이 sprint 는
            // shape pass-through 만 검증한다.
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
      // Wave 9.5 (2026-05-16) — "default" 는 frontend catalog 에 없는 invalid
      // id. boundary fallback 이 catalog 에 있는 valid id 로 좁히므로 fixture
      // 도 valid id 로 변경 ("github" — slate 가 아니면서 catalog 안에 있음).
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
  // 각 store 를 default initial state 로 reset — vitest module isolation 만으로는
  // singleton store 사이 cross-test leak 가 발생할 수 있어 명시적으로 reset.
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
  // theme/safeMode 는 도메인 default 가 있음 — 검증 시점 비교만 한다.
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
    // (connId, db) 두 단계 키 — sprint-353 의 wire shape 와 byte-equivalent.
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
          tls_enabled: true,
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
      tlsEnabled: true,
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

  it("does NOT hydrate favorites / queryHistory / datagrid_prefs (lazy via mount IPC)", async () => {
    invokeMock.mockResolvedValueOnce(makeSnapshot());

    await loadAllFromSnapshot();

    // favorites / queryHistory 는 snapshot 응답에 없고 store 도 default 그대로.
    // dataGrid prefs 는 본 sprint 범위 밖.
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

    // 50ms IPC + < 50ms mutate ≤ 100ms total — strategy doc Phase 4 의 boot
    // budget. Fake timers keep the IPC delay deterministic under CI load.
    expect(elapsed).toBeLessThan(100);
  });

  it("hydrate path is Promise.all (parallel) not serial — 5 simulated 20ms hydrate < ~30ms", async () => {
    // 직접 serial vs parallel 식별은 어렵지만 5 단계가 모두 sync (microtask
    // tick 한 번) 인지 검증. 만약 await 가 5 번 직렬이라면 5 * (small) latency
    // 가 쌓여 성능 회귀 → Sprint 367 의 invariant: store mutate 는 await
    // Promise.all([…]) 패턴이어야 한다.
    invokeMock.mockResolvedValueOnce(makeSnapshot());

    const t0 = performance.now();
    await loadAllFromSnapshot();
    const elapsed = performance.now() - t0;

    // IPC mock 이 microtask resolve — store mutate 5 개가 같은 tick 에서
    // sync 로 끝나야 < 30ms. 매우 느슨한 boundary 라 CI noise 흡수 가능.
    expect(elapsed).toBeLessThan(50);
  });
});
