/**
 * `dehydrate(workspace)` — Sprint 353 (Phase 0 dehydration pipeline,
 * state-management-strategy-2026-05-15 Q16~Q19 + M-1).
 *
 * 작성 2026-05-16 (Phase 0 sprint-353).
 *
 * 이 함수는 in-memory `WorkspaceState` 를 LS blob 으로 write 하기 직전
 * 통과시키는 순수 변환이다. invariant:
 *   - `dirtyTabIds` 는 빈 배열 (M-1, in-flight dirty 표식은 메모리만).
 *   - `sidebar.selectedNode` / `sidebar.scrollTop` 은 default (Q17/Q18).
 *   - `tabs[].queryState.status === "idle"` + rows/columns 폐기, sql 보존.
 *   - `closedTabHistory[].queryState` 도 같은 strip.
 *   - `closedTabHistory.length <= 25` (Q19 LRU cap).
 *
 * 호출자는 `WorkspacesShape` 를 순회하면서 각 `WorkspaceState` 에 대해
 * `dehydrate()` 를 호출하고, 결과를 `JSON.stringify` 해서 LS 에 write 한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  dehydrate,
  migrateLoadedWorkspaces,
  persistWorkspaces,
  STORAGE_KEY,
} from "./persistence";
import type { QueryTab, WorkspaceState } from "./types";

function makeQueryTab(overrides: Partial<QueryTab> = {}): QueryTab {
  return {
    type: "query",
    id: "q1",
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT * FROM users",
    queryState: { status: "idle" },
    paradigm: "rdb",
    ...overrides,
  };
}

function makeWorkspace(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: {
      selectedNode: null,
      expanded: [],
      scrollTop: 0,
    },
    ...overrides,
  };
}

describe("persistWorkspaces — Sprint 353 (dehydration invariants preserved as `dehydrate()` purity)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("calling persistWorkspaces no longer writes the blob to LS (sprint-358), but `dehydrate()` still strips dirtyTabIds, idle-forces queryState, and caps closedTabHistory at 25", () => {
    // 작성 2026-05-16 (sprint-358) — Sprint 353 의 strip invariants 는 dehydrate
    // 함수 자체가 보장하지만, persist 사이트가 LS 에서 SQLite-only 로 이전됨에
    // 따라 본 테스트는 (1) persistWorkspaces 호출이 더 이상 LS 에 쓰지 않음을
    // 확인하고 (2) dehydrate 의 strip 의미는 그대로 직접 호출해 검증한다.
    const completed = makeQueryTab({
      sql: "SELECT * FROM users",
      queryState: {
        status: "completed",
        result: {
          columns: [{ name: "id", data_type: "int4", category: "int" }],
          rows: [[1], [2], [3]],
          total_count: 3,
          execution_time_ms: 4,
          query_type: "select",
        },
      },
    });
    const memory: WorkspaceState = {
      tabs: [completed],
      activeTabId: completed.id,
      closedTabHistory: Array.from({ length: 30 }, (_, i) =>
        makeQueryTab({ id: `closed-${29 - i}`, sql: "SELECT 1" }),
      ),
      dirtyTabIds: [completed.id],
      sidebar: {
        selectedNode: "schema.public.users",
        expanded: ["schema.public"],
        scrollTop: 250,
      },
    };

    persistWorkspaces({ c1: { d1: memory } });
    // sprint-358 invariant: LS write 사이트 0.
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();

    // Sprint 353 strip invariants — `dehydrate()` 단독 호출로 검증.
    const persistedWs = dehydrate(memory);
    expect(persistedWs.dirtyTabIds).toEqual([]);
    expect((persistedWs.tabs[0] as QueryTab).queryState).toEqual({
      status: "idle",
    });
    expect(persistedWs.closedTabHistory).toHaveLength(25);
    expect(persistedWs.sidebar.selectedNode).toBeNull();
    expect(persistedWs.sidebar.scrollTop).toBe(0);
  });
});

describe("dehydrate — Sprint 353 (Q16/M-1 dirtyTabIds strip)", () => {
  it("strips dirtyTabIds to an empty array even when memory carries dirty markers", () => {
    const memory = makeWorkspace({ dirtyTabIds: ["tab-a", "tab-b", "tab-c"] });

    const persisted = dehydrate(memory);

    expect(persisted.dirtyTabIds).toEqual([]);
  });
});

describe("dehydrate — Sprint 353 (Q17/Q18 sidebar reset)", () => {
  it("resets sidebar.selectedNode to null and sidebar.scrollTop to 0 while preserving expanded paths", () => {
    const memory = makeWorkspace({
      sidebar: {
        selectedNode: "schema.public.users",
        expanded: ["schema.public"],
        scrollTop: 420,
      },
    });

    const persisted = dehydrate(memory);

    expect(persisted.sidebar.selectedNode).toBeNull();
    expect(persisted.sidebar.scrollTop).toBe(0);
    expect(persisted.sidebar.expanded).toEqual(["schema.public"]);
  });
});

describe("dehydrate — Sprint 353 (AC-353-01 queryState idle strip)", () => {
  it("collapses a completed queryState to idle, dropping rows/columns while preserving the sql body", () => {
    const completed = makeQueryTab({
      sql: "SELECT id, name FROM users WHERE active = true",
      queryState: {
        status: "completed",
        result: {
          columns: [
            { name: "id", data_type: "int4", category: "int" },
            { name: "name", data_type: "text", category: "text" },
          ],
          rows: [
            [1, "Alice"],
            [2, "Bob"],
          ],
          total_count: 2,
          execution_time_ms: 12,
          query_type: "select",
        },
      },
    });
    const memory = makeWorkspace({ tabs: [completed] });

    const persisted = dehydrate(memory);

    const tab = persisted.tabs[0] as QueryTab;
    expect(tab.queryState).toEqual({ status: "idle" });
    expect(tab.sql).toBe("SELECT id, name FROM users WHERE active = true");
  });

  it("collapses a running queryState in closedTabHistory to idle as well", () => {
    const inFlight = makeQueryTab({
      id: "closed-1",
      queryState: { status: "running", queryId: "q-42" },
    });
    const memory = makeWorkspace({ closedTabHistory: [inFlight] });

    const persisted = dehydrate(memory);

    const tab = persisted.closedTabHistory[0] as QueryTab;
    expect(tab.queryState).toEqual({ status: "idle" });
  });
});

describe("dehydrate — Sprint 353 (Q19 closedTabHistory cap 25)", () => {
  it("trims closedTabHistory to the most-recent 25 entries (LRU, newest-first) when memory carries 30", () => {
    // closedTabHistory is newest-first per `workspaceStore.ts:251`
    // (`[closingTab, ...ws.closedTabHistory]`). Index 0 → most recently
    // closed, index N → oldest. 30-deep history → drop oldest 5
    // (indices 25..29) so cap=25.
    const history = Array.from({ length: 30 }, (_, i) =>
      makeQueryTab({ id: `closed-${29 - i}`, title: `Closed ${29 - i}` }),
    );
    const memory = makeWorkspace({ closedTabHistory: history });

    const persisted = dehydrate(memory);

    expect(persisted.closedTabHistory).toHaveLength(25);
    expect(persisted.closedTabHistory[0]?.id).toBe("closed-29");
    expect(persisted.closedTabHistory[24]?.id).toBe("closed-5");
  });

  it("leaves closedTabHistory unchanged at exactly 25 entries (cap boundary)", () => {
    const history = Array.from({ length: 25 }, (_, i) =>
      makeQueryTab({ id: `closed-${i}` }),
    );
    const memory = makeWorkspace({ closedTabHistory: history });

    const persisted = dehydrate(memory);

    expect(persisted.closedTabHistory).toHaveLength(25);
  });
});

describe("dehydrate — Sprint 353 (AC-353-07 dirty cycle round-trip)", () => {
  it("survives a JSON round-trip with dehydrate at the boundary so rehydrated state has no dirty markers", () => {
    // Author intent: simulate the real persist path.
    //   memory --(dehydrate)--> persisted --(JSON)--> blob
    //   blob   --(JSON.parse)-> raw       --(migrate)-> rehydrated
    // Even if memory carries dirty tabs (e.g. user typed into a cell),
    // the rehydrated workspace must come back with `dirtyTabIds === []`.
    const dirtyTab = makeQueryTab({ id: "q-dirty", sql: "SELECT 1" });
    const memory = makeWorkspace({
      tabs: [dirtyTab],
      dirtyTabIds: [dirtyTab.id],
    });

    const blob = JSON.stringify(dehydrate(memory));
    const raw = JSON.parse(blob) as Partial<WorkspaceState>;
    const rehydrated = migrateLoadedWorkspaces({ c1: { d1: raw } }).c1!.d1!;

    expect(rehydrated.dirtyTabIds).toEqual([]);
    expect(rehydrated.tabs).toHaveLength(1);
    expect(rehydrated.tabs[0]?.id).toBe("q-dirty");
  });
});

describe("dehydrate — Sprint 353 (AC-353-06 LS payload budget < 50KB)", () => {
  it("keeps the persisted blob under 50KB even with 5 query tabs holding 1000-row results plus a 25-deep closedTabHistory", () => {
    // Worst-case memory snapshot the dehydration pipeline must absorb:
    //   - 5 active query tabs with `completed` queryState carrying 1000
    //     rows × ~200 byte each (≈ 1MB raw per tab, 5MB total raw).
    //   - 25-deep closedTabHistory of query tabs holding a single SELECT.
    // The strip must drop the heavy rows/columns so the on-disk blob
    // fits the LS budget agreed in Q19 / Phase 0.
    const heavyRow = Array.from(
      { length: 10 },
      (_, c) => `value-${c}-` + "x".repeat(18),
    );
    const heavyResult = {
      columns: Array.from({ length: 10 }, (_, c) => ({
        name: `col_${c}`,
        data_type: "text",
        category: "text" as const,
      })),
      rows: Array.from({ length: 1000 }, () => heavyRow),
      total_count: 1000,
      execution_time_ms: 8,
      query_type: "select" as const,
    };
    const activeTabs = Array.from({ length: 5 }, (_, i) =>
      makeQueryTab({
        id: `q-active-${i}`,
        sql: `SELECT * FROM big_table_${i}`,
        queryState: { status: "completed", result: heavyResult },
      }),
    );
    const closedHistory = Array.from({ length: 25 }, (_, i) =>
      makeQueryTab({
        id: `q-closed-${24 - i}`,
        sql: `SELECT id FROM history_${24 - i}`,
        queryState: { status: "completed", result: heavyResult },
      }),
    );
    const memory = makeWorkspace({
      tabs: activeTabs,
      closedTabHistory: closedHistory,
      dirtyTabIds: activeTabs.map((t) => t.id),
    });

    const blob = JSON.stringify({
      workspaces: { c1: { d1: dehydrate(memory) } },
    });

    expect(blob.length).toBeLessThan(50_000);
  });
});

describe("dehydrate — Sprint 353 (AC-353-08 Q17/Q18 sub-workspace round-trip)", () => {
  it("strips sidebar.selectedNode and scrollTop for every per-db workspace independently", () => {
    // Two sibling workspaces under the same connection. Each carries
    // its own sidebar selection + scroll position. Persisting must not
    // leak either field across dbs, and neither sidebar may keep its
    // selection after dehydrate.
    const dbA = makeWorkspace({
      sidebar: {
        selectedNode: "schema.public.users",
        expanded: ["schema.public"],
        scrollTop: 120,
      },
    });
    const dbB = makeWorkspace({
      sidebar: {
        selectedNode: "schema.private.orders",
        expanded: ["schema.private"],
        scrollTop: 980,
      },
    });

    const persistedA = dehydrate(dbA);
    const persistedB = dehydrate(dbB);

    expect(persistedA.sidebar).toEqual({
      selectedNode: null,
      expanded: ["schema.public"],
      scrollTop: 0,
    });
    expect(persistedB.sidebar).toEqual({
      selectedNode: null,
      expanded: ["schema.private"],
      scrollTop: 0,
    });
  });
});
