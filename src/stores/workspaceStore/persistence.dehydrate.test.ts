/**
 * `dehydrate(workspace)` — dehydration pipeline
 * (memory/engineering/architecture/state-management/memory.md).
 *
 * Written 2026-05-16.
 *
 * This function is the pure transform an in-memory `WorkspaceState` passes
 * through right before it is persisted. Invariants (IDs from
 * state-management-strategy):
 *   - `dirtyTabIds` is an empty array (M-1; in-flight dirty markers live in
 *     memory only).
 *   - `sidebar.selectedNode` / `sidebar.scrollTop` are defaults (Q17/Q18).
 *   - `tabs[].queryState.status === "idle"` + rows/columns dropped, sql kept.
 *   - `closedTabHistory[].queryState` gets the same strip.
 *   - `closedTabHistory.length <= 25` (Q19 LRU cap).
 *
 * The caller (`dehydrateAll` in `persistence.ts`) walks `WorkspacesShape`
 * and calls `dehydrate()` for each `WorkspaceState`; `persistWorkspaces`
 * then `JSON.stringify`s the parts and sends them through the
 * `persist_workspace` IPC.
 */
import { describe, expect, it } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { dehydrate, migrateLoadedWorkspaces } from "./persistence";
import type { QueryTab, WorkspaceState } from "./types";

function makeQueryTab({
  id = "q1",
  ...overrides
}: Partial<Omit<QueryTab, "id">> & { id?: string } = {}): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: "Query 1",
    connectionId: "conn1" as ConnectionId,
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

// The invariant that persistWorkspaces does not write LS (no-LS-write) has
// its single SOT in workspaceStore/persistence.no-ls-write.test.ts, and the
// describes below are the SOT for dehydrate's strip semantics — the combined
// case that bundled both into one test was pure duplication and was removed
// (issue #1631, 2026-07-22).

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
            { name: "id", dataType: "int4", category: "int" },
            { name: "name", dataType: "text", category: "text" },
          ],
          rows: [
            [1, "Alice"],
            [2, "Bob"],
          ],
          totalCount: 2,
          executionTimeMs: 12,
          queryType: "select",
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
    // fits the LS budget agreed in Q19 / state-management-strategy Phase 0.
    const heavyRow = Array.from(
      { length: 10 },
      (_, c) => `value-${c}-${"x".repeat(18)}`,
    );
    const heavyResult = {
      columns: Array.from({ length: 10 }, (_, c) => ({
        name: `col_${c}`,
        dataType: "text",
        category: "text" as const,
      })),
      rows: Array.from({ length: 1000 }, () => heavyRow),
      totalCount: 1000,
      executionTimeMs: 8,
      queryType: "select" as const,
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
