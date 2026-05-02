import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  useTabStore,
  type TableTab,
  type QueryTab,
  type Tab,
  SYNCED_KEYS,
} from "./tabStore";
import type { QueryState } from "@/types/query";
import type { SortInfo } from "@/types/schema";

function makeTableTab(
  overrides: Partial<Omit<TableTab, "id" | "isPreview">> & {
    id?: string;
    permanent?: boolean;
  },
): Omit<TableTab, "id" | "isPreview"> & { permanent?: boolean } {
  return {
    title: "Test Tab",
    connectionId: "conn1",
    type: "table",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records" as const,
    ...overrides,
  };
}

function getTableTab(state: { tabs: Tab[] }, index: number): TableTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "table") throw new Error("Expected TableTab");
  return tab;
}

function getQueryTab(state: { tabs: Tab[] }, index: number): QueryTab {
  const tab = state.tabs[index];
  if (!tab || tab.type !== "query") throw new Error("Expected QueryTab");
  return tab;
}

describe("tabStore", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
    });
  });

  it("adds a tab", () => {
    const tab = makeTableTab({ id: "ignored-by-store" });
    useTabStore.getState().addTab(tab);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.connectionId).toBe("conn1");
    expect(state.tabs[0]!.type).toBe("table");
    expect(state.activeTabId).not.toBeNull();
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("activates existing tab for same connection+table", () => {
    const tab1 = makeTableTab({
      id: "t1",
      connectionId: "conn1",
      table: "users",
    });
    const tab2 = makeTableTab({
      id: "t2",
      connectionId: "conn2",
      table: "orders",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    // Now try to add tab1 again (same connection+table)
    const tab1_dup = makeTableTab({
      id: "t3",
      connectionId: "conn1",
      table: "users",
    });
    useTabStore.getState().addTab(tab1_dup);

    const state = useTabStore.getState();
    // Should still have only 2 tabs (no new tab created)
    expect(state.tabs).toHaveLength(2);
    // Active tab should be the first tab's id
    expect(state.activeTabId).toBe(state.tabs[0]!.id);
  });

  it("removes a tab", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    expect(stateBefore.tabs).toHaveLength(2);

    // Remove the second tab
    useTabStore.getState().removeTab(stateBefore.tabs[1]!.id);

    const state = useTabStore.getState();
    expect(state.tabs).toHaveLength(1);
    expect(getTableTab(state, 0).table).toBe("users");
  });

  it("sets active tab to previous on remove", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });
    const tab3 = makeTableTab({
      id: "t3",
      table: "products",
      connectionId: "conn3",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);
    useTabStore.getState().addTab(tab3);

    const stateBefore = useTabStore.getState();
    const lastTabId = stateBefore.tabs[2]!.id;
    expect(stateBefore.activeTabId).toBe(lastTabId);

    // Remove the last (active) tab — should activate the previous one
    useTabStore.getState().removeTab(lastTabId);

    const state = useTabStore.getState();
    expect(state.activeTabId).toBe(state.tabs[1]!.id);
  });

  it("sets active tab", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    const firstTabId = stateBefore.tabs[0]!.id;

    // Switch to first tab
    useTabStore.getState().setActiveTab(firstTabId);

    expect(useTabStore.getState().activeTabId).toBe(firstTabId);
  });

  it("changes subView on a tab", () => {
    const tab = makeTableTab({ id: "t1", table: "users", subView: "records" });
    useTabStore.getState().addTab(tab);

    const stateBefore = useTabStore.getState();
    expect(getTableTab(stateBefore, 0).subView).toBe("records");

    useTabStore.getState().setSubView(stateBefore.tabs[0]!.id, "structure");

    const state = useTabStore.getState();
    expect(getTableTab(state, 0).subView).toBe("structure");
  });

  it("subView persists when switching between tabs", () => {
    const tab1 = makeTableTab({
      id: "t1",
      table: "users",
      subView: "records",
      connectionId: "conn1",
    });
    const tab2 = makeTableTab({
      id: "t2",
      table: "orders",
      subView: "records",
      connectionId: "conn2",
    });

    useTabStore.getState().addTab(tab1);
    useTabStore.getState().addTab(tab2);

    const stateBefore = useTabStore.getState();
    // Change subView on first tab to structure
    useTabStore.getState().setSubView(stateBefore.tabs[0]!.id, "structure");

    // Switch to second tab
    useTabStore.getState().setActiveTab(stateBefore.tabs[1]!.id);

    // Switch back to first tab
    useTabStore.getState().setActiveTab(stateBefore.tabs[0]!.id);

    const state = useTabStore.getState();
    // First tab should still have "structure" subView
    expect(getTableTab(state, 0).subView).toBe("structure");
    // Second tab should still have "records" subView
    expect(getTableTab(state, 1).subView).toBe("records");
  });

  // -- Query tab tests -------------------------------------------------------

  describe("query tab actions", () => {
    it("adds a query tab", () => {
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      const qt = getQueryTab(state, 0);
      expect(qt.type).toBe("query");
      expect(qt.connectionId).toBe("conn1");
      expect(qt.sql).toBe("");
      expect(qt.queryState).toEqual({ status: "idle" });
      expect(qt.closable).toBe(true);
      expect(state.activeTabId).toBe(qt.id);
    });

    it("does not deduplicate query tabs", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
    });

    it("updates query SQL", () => {
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tabId = stateBefore.tabs[0]!.id;

      useTabStore.getState().updateQuerySql(tabId, "SELECT 1");

      const state = useTabStore.getState();
      expect(getQueryTab(state, 0).sql).toBe("SELECT 1");
    });

    it("updates query state", () => {
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tabId = stateBefore.tabs[0]!.id;

      const newState: QueryState = {
        status: "completed",
        result: {
          columns: [],
          rows: [],
          total_count: 0,
          execution_time_ms: 5,
          query_type: "ddl",
        },
      };
      useTabStore.getState().updateQueryState(tabId, newState);

      const state = useTabStore.getState();
      expect(getQueryTab(state, 0).queryState.status).toBe("completed");
    });

    it("updateQuerySql only affects query tabs", () => {
      const tableTab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tableTab);
      useTabStore.getState().addQueryTab("conn1");

      const stateBefore = useTabStore.getState();
      const tableTabId = stateBefore.tabs[0]!.id;

      // This should be a no-op for table tabs
      useTabStore.getState().updateQuerySql(tableTabId, "SELECT 1");

      const state = useTabStore.getState();
      expect(state.tabs[0]!.type).toBe("table");
      // Table tab should not have sql property modified
    });

    // -- Sprint 73: paradigm + queryMode fields ------------------------------

    it("addQueryTab without opts defaults to paradigm=rdb + queryMode=sql", () => {
      useTabStore.getState().addQueryTab("conn1");

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
      // database/collection must be undefined for rdb tabs.
      expect(qt.database).toBeUndefined();
      expect(qt.collection).toBeUndefined();
    });

    it("addQueryTab with document + aggregate preserves the opts", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("document");
      expect(qt.queryMode).toBe("aggregate");
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });

    it("addQueryTab with paradigm=document defaults queryMode to find", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("document");
      expect(qt.queryMode).toBe("find");
    });

    it("addQueryTab with paradigm=rdb forces queryMode to sql even if caller asks otherwise", () => {
      useTabStore.getState().addQueryTab("conn1", {
        paradigm: "rdb",
        // Nonsensical combination — the store must normalize to "sql" so the
        // UI can't wedge itself into an unreachable state.
        queryMode: "aggregate",
      });

      const state = useTabStore.getState();
      const qt = getQueryTab(state, 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode toggles between find and aggregate on document tabs", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "db",
        collection: "users",
      });

      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().setQueryMode(tabId, "aggregate");

      let qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("aggregate");

      useTabStore.getState().setQueryMode(tabId, "find");
      qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("find");
    });

    it("setQueryMode on an rdb tab rejects non-sql modes", () => {
      useTabStore.getState().addQueryTab("conn1");
      const tabId = useTabStore.getState().tabs[0]!.id;

      useTabStore.getState().setQueryMode(tabId, "aggregate");

      const qt = getQueryTab(useTabStore.getState(), 0);
      // Must stay "sql" — the store guards against paradigm/mode drift.
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode on a non-existent tab is a no-op", () => {
      useTabStore.getState().addQueryTab("conn1");
      // Should not throw.
      useTabStore.getState().setQueryMode("ghost-id", "aggregate");

      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.queryMode).toBe("sql");
    });

    it("setQueryMode is a no-op when mode already matches current value", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
      });
      const snapshotBefore = useTabStore.getState().tabs[0];

      useTabStore.getState().setQueryMode(snapshotBefore!.id, "find");

      // Referential equality — the tab object is not replaced when unchanged.
      const snapshotAfter = useTabStore.getState().tabs[0];
      expect(snapshotAfter).toBe(snapshotBefore);
    });
  });

  // -- Sprint 84: loadQueryIntoTab helper -----------------------------------
  // AC-06..AC-10 map to the branches below. The helper is paradigm-aware:
  // it spawns a new tab when the entry targets a different paradigm or
  // connection, and updates in place when the active tab is compatible.

  describe("loadQueryIntoTab", () => {
    // AC-07 branch: no active tab → spawn new query tab.
    it("spawns a new query tab when there is no active tab", () => {
      expect(useTabStore.getState().tabs).toHaveLength(0);

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 1",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      const qt = getQueryTab(state, 0);
      expect(qt.connectionId).toBe("conn1");
      expect(qt.paradigm).toBe("rdb");
      expect(qt.queryMode).toBe("sql");
      expect(qt.sql).toBe("SELECT 1");
      expect(state.activeTabId).toBe(qt.id);
    });

    // AC-07 branch: active tab is a table tab → spawn new query tab so the
    // table context is preserved.
    it("spawns a new query tab when the active tab is a table tab", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tableTabId = useTabStore.getState().tabs[0]!.id;
      expect(useTabStore.getState().activeTabId).toBe(tableTabId);

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 1",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      // The original table tab stays put, the new tab is a query tab.
      expect(state.tabs[0]!.type).toBe("table");
      expect(state.tabs[1]!.type).toBe("query");
      expect(state.activeTabId).toBe(state.tabs[1]!.id);
      expect(getQueryTab(state, 1).sql).toBe("SELECT 1");
    });

    // AC-06 branch: same paradigm + same connection → in-place update.
    it("updates in place when the active query tab shares paradigm + connection (AC-06)", () => {
      useTabStore.getState().addQueryTab("conn1");
      const tabId = useTabStore.getState().activeTabId!;
      const tabsBefore = useTabStore.getState().tabs;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn1",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT 42",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(tabsBefore.length);
      expect(state.activeTabId).toBe(tabId);
      const qt = getQueryTab(state, 0);
      expect(qt.id).toBe(tabId);
      expect(qt.sql).toBe("SELECT 42");
      expect(qt.queryMode).toBe("sql");
    });

    // AC-07 branch: different paradigm than the active tab → spawn new tab.
    it("spawns a new tab when paradigms differ and leaves the original untouched (AC-07, AC-10)", () => {
      // Start with an RDB query tab.
      useTabStore.getState().addQueryTab("conn1");
      const rdbTabId = useTabStore.getState().activeTabId!;
      useTabStore.getState().updateQuerySql(rdbTabId, "SELECT 1");

      // Load a document paradigm entry — new tab expected.
      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
        sql: '[{"$match":{"active":true}}]',
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      const originalTab = state.tabs.find((t) => t.id === rdbTabId);
      // AC-10 — the RDB tab's sql + paradigm stay unchanged.
      expect(originalTab).toBeDefined();
      if (originalTab && originalTab.type === "query") {
        expect(originalTab.sql).toBe("SELECT 1");
        expect(originalTab.paradigm).toBe("rdb");
        expect(originalTab.queryMode).toBe("sql");
      }
      const newTabId = state.activeTabId!;
      expect(newTabId).not.toBe(rdbTabId);
      const newTab = state.tabs.find((t) => t.id === newTabId);
      expect(newTab?.type).toBe("query");
      if (newTab && newTab.type === "query") {
        expect(newTab.paradigm).toBe("document");
        expect(newTab.queryMode).toBe("aggregate");
        // AC-08 — database/collection propagate onto the new tab.
        expect(newTab.database).toBe("table_view_test");
        expect(newTab.collection).toBe("users");
        expect(newTab.sql).toBe('[{"$match":{"active":true}}]');
      }
    });

    // AC-07 branch: different connectionId, same paradigm → still spawn new tab.
    it("spawns a new tab when paradigms match but connectionId differs", () => {
      useTabStore.getState().addQueryTab("conn1");
      const firstTabId = useTabStore.getState().activeTabId!;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-other",
        paradigm: "rdb",
        queryMode: "sql",
        sql: "SELECT other",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(state.activeTabId).not.toBe(firstTabId);
      const newTab = state.tabs.find((t) => t.id === state.activeTabId);
      if (newTab && newTab.type === "query") {
        expect(newTab.connectionId).toBe("conn-other");
        expect(newTab.sql).toBe("SELECT other");
      }
    });

    // Document mode: find → aggregate within the same tab should flip
    // queryMode while preserving database / collection already on the tab.
    it("flips queryMode from find to aggregate in place on a document tab (AC-08)", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
      const docTabId = useTabStore.getState().activeTabId!;

      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "aggregate",
        database: "table_view_test",
        collection: "users",
        sql: '[{"$match":{"active":true}}]',
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe(docTabId);
      const qt = getQueryTab(state, 0);
      expect(qt.queryMode).toBe("aggregate");
      expect(qt.sql).toBe('[{"$match":{"active":true}}]');
      // AC-08 — database/collection on the tab are preserved.
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });

    // Execution-brief assumption: when loading into an existing document
    // tab the user's collection context should NOT be overwritten by the
    // entry's collection. Document/document spawns a tab only on paradigm
    // or connectionId mismatch.
    it("preserves the active tab's database/collection when loading a document entry in place", () => {
      useTabStore.getState().addQueryTab("conn-mongo", {
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "users",
      });
      const docTabId = useTabStore.getState().activeTabId!;

      // Entry points at a different collection within the same connection.
      useTabStore.getState().loadQueryIntoTab({
        connectionId: "conn-mongo",
        paradigm: "document",
        queryMode: "find",
        database: "table_view_test",
        collection: "orders",
        sql: '{"status":"open"}',
      });

      const state = useTabStore.getState();
      // Still a single tab — in-place update.
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe(docTabId);
      const qt = getQueryTab(state, 0);
      // Editor updated with the entry's SQL, but the tab's collection
      // context stays pinned to what the user was looking at.
      expect(qt.sql).toBe('{"status":"open"}');
      expect(qt.database).toBe("table_view_test");
      expect(qt.collection).toBe("users");
    });
  });

  // -- Sprint 29: Preview Tab System ----------------------------------------

  describe("preview tab system", () => {
    it("new table tab is preview by default", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).isPreview).toBe(true);
    });

    it("promoteTab sets isPreview to false", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      const tabId = state.tabs[0]!.id;

      useTabStore.getState().promoteTab(tabId);

      const updated = useTabStore.getState();
      expect(getTableTab(updated, 0).isPreview).toBe(false);
    });

    it("clicking another table replaces preview tab", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const state1 = useTabStore.getState();
      const firstTabId = state1.tabs[0]!.id;
      expect(state1.tabs).toHaveLength(1);

      // Add a different table for the same connection — should replace the preview tab
      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state2 = useTabStore.getState();
      // Still 1 tab (the preview was replaced)
      expect(state2.tabs).toHaveLength(1);
      // It should be the new table
      expect(getTableTab(state2, 0).table).toBe("orders");
      // Old tab should be gone
      expect(state2.tabs.find((t) => t.id === firstTabId)).toBeUndefined();
    });

    it("permanent tab is not replaced by new preview", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const state1 = useTabStore.getState();
      const tabId = state1.tabs[0]!.id;
      // Promote to permanent
      useTabStore.getState().promoteTab(tabId);

      // Add a different table — should NOT replace the permanent tab
      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn1",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state2 = useTabStore.getState();
      expect(state2.tabs).toHaveLength(2);
      expect(getTableTab(state2, 0).table).toBe("users");
      expect(getTableTab(state2, 1).table).toBe("orders");
    });

    it("preview tabs from different connections do not replace each other", () => {
      const tab1 = makeTableTab({
        id: "t1",
        connectionId: "conn1",
        table: "users",
      });
      useTabStore.getState().addTab(tab1);

      const tab2 = makeTableTab({
        id: "t2",
        connectionId: "conn2",
        table: "orders",
      });
      useTabStore.getState().addTab(tab2);

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
    });

    it("promoteTab on non-existent tab is a no-op", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      // Should not throw
      useTabStore.getState().promoteTab("non-existent-id");

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
    });

    // -- Sprint 136: paradigm-agnostic single/double click semantics --
    // These four tests pin AC-S136-01..04 to explicit behaviors of the
    // tabStore preview-tab API used by both the PG (`SchemaTree`) and
    // Mongo (`DocumentDatabaseTree`) sidebar trees. The semantics are
    // unified: single-click swaps the preview slot, double-click promotes
    // the active tab, same-row click is idempotent.

    // AC-S136-01 — first single-click on a row creates a preview tab
    // (`isPreview === true`). The contract uses the field name `preview`
    // in prose; we keep the existing `isPreview` field per "통합" rule.
    it("AC-S136-01: single-click creates a preview tab (isPreview === true)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).isPreview).toBe(true);
      // Active tab is the new preview tab.
      expect(state.activeTabId).toBe(state.tabs[0]!.id);
    });

    // AC-S136-01 — single-click on a different row swaps the preview slot
    // onto the new target instead of accumulating tabs. Tab count stays at
    // 1 across an arbitrary number of single-click moves.
    it("AC-S136-01: clicking a different row swaps the preview slot (no tab accumulation)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "orders",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "products",
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).table).toBe("products");
      expect(getTableTab(state, 0).isPreview).toBe(true);
    });

    // AC-S136-02 — double-click on the active tab promotes it to a
    // persistent tab (`isPreview === false`). A subsequent single-click
    // on a different row must NOT replace the now-persistent tab.
    it("AC-S136-02: promoteTab flips isPreview to false; further row clicks open a separate preview tab", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );
      const persistedId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().promoteTab(persistedId);

      const afterPromote = useTabStore.getState();
      expect(getTableTab(afterPromote, 0).isPreview).toBe(false);

      // Click on a different row → new preview tab spawned alongside
      // the persistent tab; no swap onto the persistent slot.
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "orders",
        }),
      );
      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      // First tab survives unchanged.
      expect(getTableTab(state, 0).table).toBe("users");
      expect(getTableTab(state, 0).isPreview).toBe(false);
      // Second tab is the new preview.
      expect(getTableTab(state, 1).table).toBe("orders");
      expect(getTableTab(state, 1).isPreview).toBe(true);
    });

    // AC-S136-04 — clicking the same row twice is idempotent: the preview
    // tab stays put, no new tab is created, and the tab is NOT promoted
    // (only an explicit double-click promotes — see AC-S136-02).
    it("AC-S136-04: clicking the same row twice is idempotent (no second tab, no promote)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );
      const previewId = useTabStore.getState().tabs[0]!.id;

      // Same connection + same table → addTab early-returns and only
      // updates activeTabId. The tab stays preview.
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe(previewId);
      expect(getTableTab(state, 0).isPreview).toBe(true);
    });

    // Reason: Phase 13 AC-13-06 — RDB와 Document 탭이 다른 connection이면 독립적으로 관리됨을 보장 (2026-04-28)
    it("RDB preview and Document preview tabs are independent for different connections", () => {
      // Add RDB table tab (connection "pg-1")
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "pg-1",
          table: "users",
          schema: "public",
          paradigm: "rdb",
        }),
      );

      // Add Document collection tab (connection "mongo-1")
      useTabStore.getState().addTab({
        ...makeTableTab({
          id: "ignored",
          connectionId: "mongo-1",
          table: "products",
          schema: "shop",
        }),
        paradigm: "document",
        database: "shop",
        collection: "products",
      });

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(getTableTab(state, 0).isPreview).toBe(true);
      expect(getTableTab(state, 1).isPreview).toBe(true);
      expect(getTableTab(state, 0).paradigm).toBe("rdb");
      expect(getTableTab(state, 1).paradigm).toBe("document");
    });

    // -- Sprint 158: subView-aware exact match & preview swap --

    // Reason: Same table + different subView should create a new tab, not
    //         activate the existing one. Data and Structure are distinct views
    //         of the same table and must coexist as separate tabs (2026-04-28)
    it("AC-158-01: same table + different subView → creates new tab", () => {
      // Open a Data (records) tab for "users"
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "records",
        }),
      );

      const state1 = useTabStore.getState();
      expect(state1.tabs).toHaveLength(1);
      const dataTabId = state1.tabs[0]!.id;

      // Open a Structure tab for the same "users" table
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "structure",
        }),
      );

      const state2 = useTabStore.getState();
      // Two separate tabs: one Data, one Structure
      expect(state2.tabs).toHaveLength(2);
      expect(state2.tabs.find((t) => t.id === dataTabId)).toBeDefined();
      const structTab = state2.tabs.find(
        (t): t is TableTab =>
          t.type === "table" && (t as TableTab).subView === "structure",
      );
      expect(structTab).toBeDefined();
      // Active tab should be the newly created Structure tab
      expect(state2.activeTabId).toBe(structTab!.id);
    });

    // Reason: Same table + same subView should still activate the existing tab.
    //         This is a regression guard — the subView fix must not break the
    //         original exact-match behavior (2026-04-28)
    it("AC-158-02: same table + same subView → activates existing tab (regression)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "records",
        }),
      );

      const state1 = useTabStore.getState();
      expect(state1.tabs).toHaveLength(1);
      const originalId = state1.tabs[0]!.id;

      // Try to open the same table + subView again
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "records",
        }),
      );

      const state2 = useTabStore.getState();
      // Still 1 tab, same ID — just activated
      expect(state2.tabs).toHaveLength(1);
      expect(state2.tabs[0]!.id).toBe(originalId);
      expect(state2.activeTabId).toBe(originalId);
    });

    // Reason: A Data preview tab should only be swapped by another Data tab,
    //         not by a Structure tab. When user has a Data preview and clicks
    //         "View Structure", a new Structure tab should be created alongside
    //         the Data preview (2026-04-28)
    it("AC-158-03: Data preview + Structure click → creates new Structure preview (no swap)", () => {
      // Open a Data preview tab
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "records",
        }),
      );

      const state1 = useTabStore.getState();
      expect(state1.tabs).toHaveLength(1);
      expect(getTableTab(state1, 0).isPreview).toBe(true);
      expect(getTableTab(state1, 0).subView).toBe("records");
      const dataPreviewId = state1.tabs[0]!.id;

      // Open a Structure tab for the same table (like "View Structure" context menu)
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          subView: "structure",
        }),
      );

      const state2 = useTabStore.getState();
      // Two tabs: the original Data preview + a new Structure preview
      expect(state2.tabs).toHaveLength(2);
      // Data preview survives
      expect(state2.tabs.find((t) => t.id === dataPreviewId)).toBeDefined();
      // Structure tab was created
      const structTab = state2.tabs.find(
        (t): t is TableTab =>
          t.type === "table" && (t as TableTab).subView === "structure",
      );
      expect(structTab).toBeDefined();
      expect(structTab!.isPreview).toBe(true);
      // Active tab is the new Structure tab
      expect(state2.activeTabId).toBe(structTab!.id);
    });
  });

  // -- permanent option (addTab lifecycle redesign) -------------------------

  describe("addTab permanent option", () => {
    // Reason: permanent: true creates a persistent tab directly, skipping the
    // preview stage. This is used by double-click handlers so the tab lifecycle
    // is managed entirely within the store. (2026-04-29)
    it("permanent: true creates a tab with isPreview === false", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          permanent: true,
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).isPreview).toBe(false);
    });

    // Reason: permanent: false (default) creates a preview tab that will be
    // swapped by subsequent single-clicks on the same connection.
    it("permanent: false (default) creates a preview tab", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(getTableTab(state, 0).isPreview).toBe(true);
    });

    // Reason: when permanent: true is passed and an exact-match preview tab
    // already exists, addTab should promote it in-place rather than creating a
    // duplicate.
    it("permanent: true promotes an existing preview tab with the same table", () => {
      // Single-click → preview
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );
      const previewId = useTabStore.getState().tabs[0]!.id;
      expect(getTableTab(useTabStore.getState(), 0).isPreview).toBe(true);

      // Double-click same table → promote in-place
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          permanent: true,
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe(previewId);
      expect(getTableTab(state, 0).isPreview).toBe(false);
    });

    // Reason: permanent: true should NOT replace an existing preview slot —
    // it always creates a new persistent tab alongside any existing preview.
    it("permanent: true does not replace an existing preview slot for a different table", () => {
      // Preview for "users"
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
        }),
      );

      // Permanent for "orders" → should create alongside, not replace
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "orders",
          permanent: true,
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(2);
      expect(getTableTab(state, 0).table).toBe("users");
      expect(getTableTab(state, 0).isPreview).toBe(true);
      expect(getTableTab(state, 1).table).toBe("orders");
      expect(getTableTab(state, 1).isPreview).toBe(false);
    });

    // Reason: permanent: true with an existing persistent tab should just
    // activate it without creating a duplicate.
    it("permanent: true activates an existing persistent tab without duplication", () => {
      // Create persistent tab
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          permanent: true,
        }),
      );
      const persistentId = useTabStore.getState().tabs[0]!.id;

      // Try to open same table again with permanent: true
      useTabStore.getState().addTab(
        makeTableTab({
          id: "ignored",
          connectionId: "conn1",
          table: "users",
          permanent: true,
        }),
      );

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe(persistentId);
      expect(state.activeTabId).toBe(persistentId);
    });
  });

  // -- Sprint 38: Tab State Persistence --

  describe("tab state persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      storage = {};
      vi.useFakeTimers();
      vi.stubGlobal("localStorage", {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete storage[key];
        }),
        clear: vi.fn(() => {
          storage = {};
        }),
        get length() {
          return Object.keys(storage).length;
        },
        key: vi.fn(() => null),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("persists tabs to localStorage on change", () => {
      useTabStore.getState().addQueryTab("conn1");

      // Advance past debounce timer
      vi.advanceTimersByTime(300);

      // The store should have called setItem
      const setItemCalls = (localStorage.setItem as ReturnType<typeof vi.fn>)
        .mock.calls;
      const lastCall = setItemCalls[setItemCalls.length - 1];
      expect(lastCall).toBeDefined();
      if (lastCall) {
        expect(lastCall[0]).toBe("table-view-tabs");
        const parsed = JSON.parse(lastCall[1]);
        expect(parsed.tabs).toHaveLength(1);
      }
    });

    it("loads persisted tabs on initialization", () => {
      const persistedState = {
        tabs: [
          {
            type: "query",
            id: "query-1",
            title: "Query 1",
            connectionId: "conn1",
            closable: true,
            sql: "SELECT 1",
            queryState: { status: "idle" },
          },
        ],
        activeTabId: "query-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.activeTabId).toBe("query-1");
    });

    it("resets query state to idle when loading persisted tabs", () => {
      const persistedState = {
        tabs: [
          {
            type: "query",
            id: "query-1",
            title: "Query 1",
            connectionId: "conn1",
            closable: true,
            sql: "SELECT 1",
            queryState: { status: "running", queryId: "old-qid" },
          },
        ],
        activeTabId: "query-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const qt = state.tabs[0];
      if (qt && qt.type === "query") {
        expect(qt.queryState).toEqual({ status: "idle" });
      }
    });

    it("handles corrupted localStorage gracefully", () => {
      storage["table-view-tabs"] = "not valid json{{{";

      // Should not throw
      expect(() => useTabStore.getState().loadPersistedTabs()).not.toThrow();

      const state = useTabStore.getState();
      expect(state.tabs).toEqual([]);
      expect(state.activeTabId).toBeNull();
    });

    it("migrates legacy TableTabs without paradigm to rdb", () => {
      // Sprint 66: the `paradigm` field didn't exist on TableTab before this
      // sprint. All legacy persisted tabs targeted an RDB connection, so the
      // migration must default them to "rdb" instead of leaving `undefined`.
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      expect(tt?.type).toBe("table");
      if (tt && tt.type === "table") {
        expect(tt.paradigm).toBe("rdb");
        expect(tt.isPreview).toBe(false);
      }
    });

    it("preserves a persisted paradigm=document TableTab on load", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "table_view_test.users",
            connectionId: "conn-mongo",
            closable: true,
            schema: "table_view_test",
            table: "users",
            subView: "records",
            paradigm: "document",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      if (tt && tt.type === "table") {
        expect(tt.paradigm).toBe("document");
      }
    });

    // Sprint 129 — backfill database/collection from schema/table on load
    // for legacy persisted document tabs. The migration is idempotent and
    // RDB tabs must be left alone.
    it("backfills database/collection on legacy document tabs (sprint 129)", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "table_view_test.users",
            connectionId: "conn-mongo",
            closable: true,
            schema: "table_view_test",
            table: "users",
            subView: "records",
            paradigm: "document",
            // database / collection are intentionally absent — pre-S129.
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      expect(tt?.type).toBe("table");
      if (tt && tt.type === "table") {
        expect(tt.database).toBe("table_view_test");
        expect(tt.collection).toBe("users");
        // Legacy schema/table are preserved for backwards-compat.
        expect(tt.schema).toBe("table_view_test");
        expect(tt.table).toBe("users");
      }
    });

    it("does not backfill database/collection on RDB tabs (sprint 129)", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            paradigm: "rdb",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      if (tt && tt.type === "table") {
        // RDB tabs must keep document fields undefined — these fields are
        // document-paradigm-only and the migration must not touch them.
        expect(tt.database).toBeUndefined();
        expect(tt.collection).toBeUndefined();
        expect(tt.schema).toBe("public");
        expect(tt.table).toBe("users");
      }
    });

    it("is idempotent when database/collection already populated (sprint 129)", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "table_view_test.users",
            connectionId: "conn-mongo",
            closable: true,
            schema: "stale_schema",
            table: "stale_table",
            subView: "records",
            paradigm: "document",
            // Already migrated — must not be overwritten by schema/table.
            database: "table_view_test",
            collection: "users",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const state = useTabStore.getState();
      const tt = state.tabs[0];
      if (tt && tt.type === "table") {
        expect(tt.database).toBe("table_view_test");
        expect(tt.collection).toBe("users");
      }
    });
  });

  // -- Tab drag reorder --

  describe("moveTab", () => {
    beforeEach(() => {
      useTabStore.setState({ tabs: [], activeTabId: null });
    });

    it("inserts BEFORE the target when position='before'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      expect(before).toHaveLength(3);

      useTabStore.getState().moveTab(before[0]!, before[2]!, "before");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t0 inserts before t2 → [t1, t0, t2]
      expect(after).toEqual([before[1], before[0], before[2]]);
    });

    it("inserts AFTER the target when position='after'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);

      useTabStore.getState().moveTab(before[0]!, before[2]!, "after");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t0 inserts after t2 → [t1, t2, t0]
      expect(after).toEqual([before[1], before[2], before[0]]);
    });

    it("inserts BEFORE when dragging right-to-left with position='before'", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);

      useTabStore.getState().moveTab(before[2]!, before[0]!, "before");

      const after = useTabStore.getState().tabs.map((t) => t.id);
      // t2 inserts before t0 → [t2, t0, t1]
      expect(after).toEqual([before[2], before[0], before[1]]);
    });

    it("is a no-op when fromId === toId", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      useTabStore.getState().moveTab(before[0]!, before[0]!);

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
    });

    it("is a no-op when an id does not exist", () => {
      useTabStore.getState().addQueryTab("conn1");

      const before = useTabStore.getState().tabs.map((t) => t.id);
      useTabStore.getState().moveTab(before[0]!, "ghost-id");

      expect(useTabStore.getState().tabs.map((t) => t.id)).toEqual(before);
    });

    it("does not change activeTabId", () => {
      useTabStore.getState().addQueryTab("conn1");
      useTabStore.getState().addQueryTab("conn1");

      const { activeTabId, tabs } = useTabStore.getState();
      useTabStore.getState().moveTab(tabs[0]!.id, tabs[1]!.id);

      expect(useTabStore.getState().activeTabId).toBe(activeTabId);
    });
  });

  // -- Sprint 45: Reopen last closed tab --

  describe("reopen last closed tab", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
    });

    it("removes tab and saves it to closedTabHistory", () => {
      const tab = makeTableTab({ id: "t1", table: "users" });
      useTabStore.getState().addTab(tab);

      const state = useTabStore.getState();
      const tabId = state.tabs[0]!.id;

      useTabStore.getState().removeTab(tabId);

      const afterRemove = useTabStore.getState();
      expect(afterRemove.tabs).toHaveLength(0);
      expect(afterRemove.closedTabHistory).toHaveLength(1);
      expect(afterRemove.closedTabHistory[0]!.type).toBe("table");
    });

    it("reopens last closed tab", () => {
      useTabStore.getState().addQueryTab("conn1");
      const state1 = useTabStore.getState();
      const queryTabId = state1.tabs[0]!.id;

      // Update the SQL so we can verify it's restored
      useTabStore.getState().updateQuerySql(queryTabId, "SELECT 1");

      // Close it
      useTabStore.getState().removeTab(queryTabId);

      expect(useTabStore.getState().tabs).toHaveLength(0);

      // Reopen
      useTabStore.getState().reopenLastClosedTab();

      const afterReopen = useTabStore.getState();
      expect(afterReopen.tabs).toHaveLength(1);
      expect(afterReopen.activeTabId).toBe(afterReopen.tabs[0]!.id);
      // SQL content should be preserved (query state is reset to idle)
      const reopened = getQueryTab(afterReopen, 0);
      expect(reopened.sql).toBe("SELECT 1");
      // History should be cleared
      expect(afterReopen.closedTabHistory).toHaveLength(0);
    });

    it("reopenLastClosedTab is a no-op when history is empty", () => {
      useTabStore.getState().reopenLastClosedTab();

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(0);
      expect(state.activeTabId).toBeNull();
    });

    it("limits closedTabHistory to 20 entries", () => {
      // Add and remove 25 tabs
      for (let i = 0; i < 25; i++) {
        useTabStore.getState().addQueryTab("conn1");
        const state = useTabStore.getState();
        const lastTabId = state.tabs[state.tabs.length - 1]!.id;
        useTabStore.getState().removeTab(lastTabId);
      }

      const state = useTabStore.getState();
      expect(state.closedTabHistory.length).toBe(20);
    });
  });

  // -- Sprint 76: Per-tab sort state --

  describe("per-tab sort state", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
    });

    // AC-01 — new tab starts with sorts undefined (optional field, no
    // surprise value). Consumers that need an array read `tab.sorts ?? []`.
    it("addTab does not pre-seed sorts; new tab's sorts is undefined", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));

      const state = useTabStore.getState();
      expect(getTableTab(state, 0).sorts).toBeUndefined();
    });

    it("addTab preserves sorts when the caller provides them", () => {
      const sorts: SortInfo[] = [{ column: "id", direction: "ASC" }];
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts,
      });

      const state = useTabStore.getState();
      expect(getTableTab(state, 0).sorts).toEqual(sorts);
    });

    // AC-02 — updateTabSorts writes into one tab only.
    it("updateTabSorts writes the target tab's sorts", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;

      const next: SortInfo[] = [{ column: "id", direction: "DESC" }];
      useTabStore.getState().updateTabSorts(tabId, next);

      const updated = useTabStore.getState();
      expect(getTableTab(updated, 0).sorts).toEqual(next);
    });

    it("updateTabSorts leaves sibling tabs untouched (per-tab isolation)", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t1",
          connectionId: "conn1",
          table: "users",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t2",
          connectionId: "conn2",
          table: "orders",
        }),
      );

      const [first, second] = useTabStore.getState().tabs;
      useTabStore
        .getState()
        .updateTabSorts(first!.id, [{ column: "id", direction: "ASC" }]);

      const state = useTabStore.getState();
      const tabA = state.tabs.find((t) => t.id === first!.id) as TableTab;
      const tabB = state.tabs.find((t) => t.id === second!.id) as TableTab;
      expect(tabA.sorts).toEqual([{ column: "id", direction: "ASC" }]);
      expect(tabB.sorts).toBeUndefined();
    });

    it("updateTabSorts on a non-existent tab is a no-op", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const before = useTabStore.getState().tabs[0]!;

      useTabStore
        .getState()
        .updateTabSorts("ghost-id", [{ column: "name", direction: "DESC" }]);

      const after = useTabStore.getState().tabs[0]! as TableTab;
      expect(after).toEqual(before);
    });

    it("updateTabSorts does not touch query tabs even if the ids collide", () => {
      useTabStore.getState().addQueryTab("conn1");
      const qtId = useTabStore.getState().tabs[0]!.id;

      useTabStore
        .getState()
        .updateTabSorts(qtId, [{ column: "id", direction: "ASC" }]);

      const qt = getQueryTab(useTabStore.getState(), 0);
      // QueryTab should never grow a `sorts` field.
      expect((qt as unknown as { sorts?: SortInfo[] }).sorts).toBeUndefined();
    });

    it("tab A's sort survives switching to tab B and back", () => {
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t1",
          connectionId: "conn1",
          table: "users",
        }),
      );
      useTabStore.getState().addTab(
        makeTableTab({
          id: "t2",
          connectionId: "conn2",
          table: "orders",
        }),
      );
      const [first, second] = useTabStore.getState().tabs;
      useTabStore
        .getState()
        .updateTabSorts(first!.id, [{ column: "id", direction: "DESC" }]);

      useTabStore.getState().setActiveTab(second!.id);
      useTabStore.getState().setActiveTab(first!.id);

      const state = useTabStore.getState();
      const tabA = state.tabs.find((t) => t.id === first!.id) as TableTab;
      expect(tabA.sorts).toEqual([{ column: "id", direction: "DESC" }]);
    });

    it("supports 5+ multi-column sort entries", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      const sorts: SortInfo[] = [
        { column: "a", direction: "ASC" },
        { column: "b", direction: "DESC" },
        { column: "c", direction: "ASC" },
        { column: "d", direction: "DESC" },
        { column: "e", direction: "ASC" },
      ];

      useTabStore.getState().updateTabSorts(tabId, sorts);

      expect(getTableTab(useTabStore.getState(), 0).sorts).toEqual(sorts);
    });

    it("accepts an empty sorts array (clears sort on the tab)", () => {
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts: [{ column: "id", direction: "ASC" }],
      });
      const tabId = useTabStore.getState().tabs[0]!.id;

      useTabStore.getState().updateTabSorts(tabId, []);

      expect(getTableTab(useTabStore.getState(), 0).sorts).toEqual([]);
    });
  });

  // -- Sprint 76: sort persistence + legacy migration --

  describe("per-tab sort persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      storage = {};
      vi.useFakeTimers();
      vi.stubGlobal("localStorage", {
        getItem: vi.fn((key: string) => storage[key] ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete storage[key];
        }),
        clear: vi.fn(() => {
          storage = {};
        }),
        get length() {
          return Object.keys(storage).length;
        },
        key: vi.fn(() => null),
      });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    // AC-04 — legacy persisted tab missing `sorts` migrates to `[]`
    // without throwing so the app still boots on prior data.
    it("loadPersistedTabs normalises legacy TableTab (missing sorts) to []", () => {
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            paradigm: "rdb",
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      expect(() => useTabStore.getState().loadPersistedTabs()).not.toThrow();

      const tt = useTabStore.getState().tabs[0]!;
      expect(tt.type).toBe("table");
      if (tt.type === "table") {
        expect(tt.sorts).toEqual([]);
      }
    });

    it("loadPersistedTabs preserves persisted sorts on a TableTab", () => {
      const persistedSorts: SortInfo[] = [
        { column: "id", direction: "DESC" },
        { column: "name", direction: "ASC" },
      ];
      const persistedState = {
        tabs: [
          {
            type: "table",
            id: "tab-1",
            title: "public.users",
            connectionId: "conn1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            paradigm: "rdb",
            sorts: persistedSorts,
          },
        ],
        activeTabId: "tab-1",
      };
      storage["table-view-tabs"] = JSON.stringify(persistedState);

      useTabStore.getState().loadPersistedTabs();

      const tt = useTabStore.getState().tabs[0]!;
      if (tt.type === "table") {
        expect(tt.sorts).toEqual(persistedSorts);
      }
    });

    // Round-trip: write → read restores sort on the same tab id.
    it("persists sort updates and restores them on reload", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      const sorts: SortInfo[] = [{ column: "id", direction: "ASC" }];
      useTabStore.getState().updateTabSorts(tabId, sorts);

      // Flush debounce timer to commit persistence.
      vi.advanceTimersByTime(300);

      // Reset in-memory state, then reload from storage.
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      useTabStore.getState().loadPersistedTabs();

      const loaded = useTabStore.getState().tabs[0]!;
      if (loaded.type === "table") {
        expect(loaded.sorts).toEqual(sorts);
      }
    });

    it("reopenLastClosedTab restores the tab's sorts", () => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      useTabStore.getState().addTab({
        ...makeTableTab({ id: "t1", table: "users" }),
        sorts: [{ column: "created_at", direction: "DESC" }],
      });
      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().removeTab(tabId);

      useTabStore.getState().reopenLastClosedTab();

      const reopened = useTabStore.getState().tabs[0]!;
      expect(reopened.type).toBe("table");
      if (reopened.type === "table") {
        expect(reopened.sorts).toEqual([
          { column: "created_at", direction: "DESC" },
        ]);
      }
    });
  });

  // -- Sprint 97: dirty tab tracking ----------------------------------------

  describe("setTabDirty / dirtyTabIds", () => {
    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
        dirtyTabIds: new Set<string>(),
      });
    });

    it("starts empty", () => {
      expect(useTabStore.getState().dirtyTabIds.size).toBe(0);
    });

    it("adds the id when setTabDirty(id, true)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.size).toBe(1);
    });

    it("removes the id when setTabDirty(id, false)", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);

      expect(useTabStore.getState().dirtyTabIds.has("tab-1")).toBe(false);
    });

    it("is a no-op when membership already matches the requested value", () => {
      // Idempotent dirty=true → keeps Set referential equality so subscriber
      // selectors don't re-render on every keystroke during editing.
      useTabStore.getState().setTabDirty("tab-1", true);
      const before = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("tab-1", true);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after).toBe(before);

      // Idempotent dirty=false on a non-member tab also preserves identity.
      const cleanBefore = useTabStore.getState().dirtyTabIds;
      useTabStore.getState().setTabDirty("never-dirty", false);
      const cleanAfter = useTabStore.getState().dirtyTabIds;
      expect(cleanAfter).toBe(cleanBefore);
    });

    it("tracks multiple dirty tabs independently", () => {
      useTabStore.getState().setTabDirty("tab-1", true);
      useTabStore.getState().setTabDirty("tab-2", true);

      const dirty = useTabStore.getState().dirtyTabIds;
      expect(dirty.has("tab-1")).toBe(true);
      expect(dirty.has("tab-2")).toBe(true);

      useTabStore.getState().setTabDirty("tab-1", false);
      const after = useTabStore.getState().dirtyTabIds;
      expect(after.has("tab-1")).toBe(false);
      expect(after.has("tab-2")).toBe(true);
    });

    it("removeTab also drops the dirty marker", () => {
      useTabStore.getState().addTab(makeTableTab({ id: "t1", table: "users" }));
      const tabId = useTabStore.getState().tabs[0]!.id;
      useTabStore.getState().setTabDirty(tabId, true);
      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(true);

      useTabStore.getState().removeTab(tabId);

      expect(useTabStore.getState().dirtyTabIds.has(tabId)).toBe(false);
    });
  });

  // -- Sprint 130 — RDB tab database autofill ---------------------------

  describe("RDB database autofill (Sprint 130)", () => {
    beforeEach(async () => {
      // Reset connectionStore so the autofill helper has known input.
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {},
      });
    });

    it("autofills database from activeStatuses[id].activeDb when adding an RDB table tab", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addTab(makeTableTab({ id: "ignored" }));
      const tab = getTableTab(useTabStore.getState(), 0);
      expect(tab.database).toBe("warehouse");
    });

    it("falls back to connection.database when activeDb is not yet set", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [
          {
            id: "conn1",
            name: "TestDB",
            db_type: "postgresql",
            host: "localhost",
            port: 5432,
            user: "postgres",
            database: "postgres",
            group_id: null,
            color: null,
            has_password: false,
            paradigm: "rdb",
          },
        ],
        activeStatuses: { conn1: { type: "connected" } },
      });
      useTabStore.getState().addTab(makeTableTab({ id: "ignored" }));
      const tab = getTableTab(useTabStore.getState(), 0);
      expect(tab.database).toBe("postgres");
    });

    it("autofills database for a new RDB query tab from activeDb", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "reporting" },
        },
      });
      useTabStore.getState().addQueryTab("conn1");
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.paradigm).toBe("rdb");
      expect(qt.database).toBe("reporting");
    });

    it("does not overwrite an explicitly-passed database on addQueryTab", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addQueryTab("conn1", { database: "explicit_db" });
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.database).toBe("explicit_db");
    });

    it("does not migrate already-persisted RDB tabs (autofill is creation-only)", () => {
      // Simulate an RDB tab already in the store with no `database` —
      // the contract forbids touching legacy persisted tabs. Adding a
      // brand-new tab should populate `database`, but the existing tab
      // must stay untouched.
      const persistedTab: TableTab = {
        type: "table",
        id: "existing",
        title: "legacy",
        connectionId: "conn1",
        closable: true,
        schema: "public",
        table: "legacy_table",
        subView: "records",
      };
      useTabStore.setState({ tabs: [persistedTab], activeTabId: "existing" });
      const tab = useTabStore.getState().tabs[0] as TableTab;
      expect(tab.database).toBeUndefined();
    });

    it("does not autofill database for document paradigm query tabs (S131 handles use_db)", async () => {
      const { useConnectionStore } = await import("./connectionStore");
      useConnectionStore.setState({
        connections: [],
        activeStatuses: {
          conn1: { type: "connected", activeDb: "warehouse" },
        },
      });
      useTabStore.getState().addQueryTab("conn1", { paradigm: "document" });
      const qt = getQueryTab(useTabStore.getState(), 0);
      expect(qt.paradigm).toBe("document");
      // Document tabs only inherit a database when the caller passes one.
      expect(qt.database).toBeUndefined();
    });
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys ride the `tab-sync`
  // channel. Critical exclusions:
  //  - `dirtyTabIds` is a `Set<string>` and is NOT JSON-serializable, so
  //    broadcasting it would corrupt the receiver's state.
  //  - `closedTabHistory` is per-window undo scope — a Cmd-Shift-T in one
  //    window must not resurrect a tab the OTHER window closed.
  // The bridge itself only attaches in the workspace window (guarded by
  // `getCurrentWindowLabel()`); this regression pins the allowlist shape.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    it("exposes exactly the cross-window-synced tab keys", () => {
      expect([...SYNCED_KEYS]).toEqual(["tabs", "activeTabId"]);
    });

    it("does NOT include dirtyTabIds (Set, non-serializable)", () => {
      expect(SYNCED_KEYS).not.toContain("dirtyTabIds");
    });

    it("does NOT include closedTabHistory (window-local undo scope)", () => {
      expect(SYNCED_KEYS).not.toContain("closedTabHistory");
    });
  });

  // ── Sprint 195 — intent-revealing query lifecycle actions ───────────────
  //
  // These actions hide the guarded `running → completed | error` transition
  // pattern that QueryTab.tsx previously inlined 7 times via raw
  // `useTabStore.setState((state) => ...)`. The guards ensure stale
  // responses (late-arriving result for a queryId that was already
  // superseded) cannot overwrite a fresher query's state.
  describe("query lifecycle actions (sprint-195 §3.1 extraction)", () => {
    function seedRunningQueryTab(
      tabId = "q1",
      queryId = "q1-1700000000",
    ): void {
      const tab: QueryTab = {
        type: "query",
        id: tabId,
        title: "Query 1",
        connectionId: "conn1",
        closable: true,
        sql: "SELECT 1",
        queryState: { status: "running", queryId },
        paradigm: "rdb",
        queryMode: "sql",
      } as QueryTab;
      useTabStore.setState({ tabs: [tab], activeTabId: tabId });
    }

    const sampleResult = {
      columns: [{ name: "n", data_type: "integer" }],
      rows: [[1]],
      total_count: 1,
      execution_time_ms: 5,
      query_type: "select" as const,
    };

    describe("[AC-195-01] completeQuery / failQuery guards", () => {
      it("[AC-195-01-1] completeQuery transitions running → completed when queryId matches", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore
          .getState()
          .completeQuery("q1", "q1-1", sampleResult as never);
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({
          status: "completed",
          result: sampleResult,
        });
      });

      it("[AC-195-01-2] completeQuery is a no-op when queryId mismatches (stale response)", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore
          .getState()
          .completeQuery("q1", "q1-stale", sampleResult as never);
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "running", queryId: "q1-1" });
      });

      it("[AC-195-01-3] completeQuery is a no-op when tab is not running", () => {
        const tab: QueryTab = {
          type: "query",
          id: "q1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "idle" },
          paradigm: "rdb",
          queryMode: "sql",
        } as QueryTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "q1" });

        useTabStore
          .getState()
          .completeQuery("q1", "anything", sampleResult as never);
        const out = getQueryTab(useTabStore.getState(), 0);
        expect(out.queryState).toEqual({ status: "idle" });
      });

      it("[AC-195-01-4] completeQuery is a no-op for missing tab", () => {
        useTabStore.setState({ tabs: [], activeTabId: null });
        useTabStore
          .getState()
          .completeQuery("missing", "any", sampleResult as never);
        expect(useTabStore.getState().tabs).toHaveLength(0);
      });

      it("[AC-195-01-5] failQuery transitions running → error when queryId matches", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore.getState().failQuery("q1", "q1-1", "boom");
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "error", error: "boom" });
      });

      it("[AC-195-01-6] failQuery is a no-op when queryId mismatches (stale response)", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore.getState().failQuery("q1", "q1-stale", "boom");
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState).toEqual({ status: "running", queryId: "q1-1" });
      });
    });

    describe("[AC-195-02] completeMultiStatementQuery allFailed branching", () => {
      const stmt = (status: "success" | "error", error?: string) => ({
        sql: status === "success" ? "SELECT 1" : "SELECT bad",
        status,
        result: status === "success" ? sampleResult : undefined,
        error,
        durationMs: 1,
      });

      it("[AC-195-02-1] allFailed → error with joined message", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("error", "syntax 1") as never,
            stmt("error", "syntax 2") as never,
          ],
          lastResult: null,
          allFailed: true,
          joinedErrorMessage: "Statement 1: syntax 1\nStatement 2: syntax 2",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("error");
      });

      it("[AC-195-02-2] partial failure → completed with statements + lastResult", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("success") as never,
            stmt("error", "later one failed") as never,
          ],
          lastResult: sampleResult as never,
          allFailed: false,
          joinedErrorMessage: "ignored",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("completed");
        if (tab.queryState.status === "completed") {
          expect(tab.queryState.result).toEqual(sampleResult);
          expect(tab.queryState.statements).toHaveLength(2);
        }
      });

      it("[AC-195-02-3] all-success → completed with statements + lastResult", () => {
        seedRunningQueryTab("q1", "q1-1");
        useTabStore.getState().completeMultiStatementQuery("q1", "q1-1", {
          statementResults: [
            stmt("success") as never,
            stmt("success") as never,
          ],
          lastResult: sampleResult as never,
          allFailed: false,
          joinedErrorMessage: "",
        });
        const tab = getQueryTab(useTabStore.getState(), 0);
        expect(tab.queryState.status).toBe("completed");
      });
    });

    describe("[AC-195-03] recordHistory auto-extracts tab metadata", () => {
      // A fresh queryHistoryStore instance is exposed on every test via
      // beforeEach reset; we read entries through its `.getState()`.
      it("[AC-195-03-1] records entry from a query tab with paradigm/queryMode/connectionId/database/collection", async () => {
        const tab: QueryTab = {
          type: "query",
          id: "q1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "completed", result: sampleResult } as never,
          paradigm: "document",
          queryMode: "find",
          database: "appdb",
          collection: "users",
        } as QueryTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "q1" });

        const { useQueryHistoryStore } =
          await import("@stores/queryHistoryStore");
        useQueryHistoryStore.setState({ entries: [], globalLog: [] });

        useTabStore.getState().recordHistory("q1", {
          sql: "db.users.find()",
          executedAt: 1700000000,
          duration: 12,
          status: "success",
        });

        const entries = useQueryHistoryStore.getState().entries;
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
          sql: "db.users.find()",
          status: "success",
          connectionId: "conn1",
          paradigm: "document",
          queryMode: "find",
          database: "appdb",
          collection: "users",
        });
      });

      it("[AC-195-03-2] silent no-op when tab is not a query tab", async () => {
        const tab: TableTab = {
          type: "table",
          id: "t1",
          title: "Users",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records" as const,
        } as TableTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "t1" });

        const { useQueryHistoryStore } =
          await import("@stores/queryHistoryStore");
        useQueryHistoryStore.setState({ entries: [], globalLog: [] });

        useTabStore.getState().recordHistory("t1", {
          sql: "ignored",
          executedAt: 1,
          duration: 1,
          status: "success",
        });

        expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
      });

      it("[AC-195-03-3] silent no-op when tab is missing", async () => {
        useTabStore.setState({ tabs: [], activeTabId: null });
        const { useQueryHistoryStore } =
          await import("@stores/queryHistoryStore");
        useQueryHistoryStore.setState({ entries: [], globalLog: [] });

        useTabStore.getState().recordHistory("missing", {
          sql: "ignored",
          executedAt: 1,
          duration: 1,
          status: "error",
        });

        expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
      });
    });

    // -------------------------------------------------------------------------
    // AC-196-02 — `recordHistory` accepts an optional `source` and forwards it
    // to the queryHistoryStore. Sprint 195 added the wrapper, Sprint 196
    // (FB-5b) widens the payload so callsites that originate outside the
    // editor pipeline (Sprint 195 already wired Tab → editor; Sprint 196 is
    // adding grid-edit / DDL / mongo-op fire points) can label themselves.
    // 2026-05-02.
    // -------------------------------------------------------------------------

    describe("[AC-196-02] recordHistory source argument", () => {
      it("[AC-196-02-1] defaults missing source to 'raw'", async () => {
        const tab: QueryTab = {
          type: "query",
          id: "q1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "SELECT 1",
          queryState: { status: "completed", result: sampleResult } as never,
          paradigm: "rdb",
          queryMode: "sql",
        } as QueryTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "q1" });

        const { useQueryHistoryStore } =
          await import("@stores/queryHistoryStore");
        useQueryHistoryStore.setState({ entries: [], globalLog: [] });

        useTabStore.getState().recordHistory("q1", {
          sql: "SELECT 1",
          executedAt: 1,
          duration: 1,
          status: "success",
        });

        expect(useQueryHistoryStore.getState().entries[0]!.source).toBe("raw");
      });

      it("[AC-196-02-2] forwards explicit source onto the stored entry", async () => {
        const tab: QueryTab = {
          type: "query",
          id: "q1",
          title: "Query 1",
          connectionId: "conn1",
          closable: true,
          sql: "db.users.insertOne({})",
          queryState: { status: "completed", result: sampleResult } as never,
          paradigm: "document",
          queryMode: "find",
          database: "appdb",
          collection: "users",
        } as QueryTab;
        useTabStore.setState({ tabs: [tab], activeTabId: "q1" });

        const { useQueryHistoryStore } =
          await import("@stores/queryHistoryStore");
        useQueryHistoryStore.setState({ entries: [], globalLog: [] });

        useTabStore.getState().recordHistory("q1", {
          sql: "db.users.insertOne({})",
          executedAt: 1,
          duration: 1,
          status: "success",
          source: "mongo-op",
        });

        expect(useQueryHistoryStore.getState().entries[0]!.source).toBe(
          "mongo-op",
        );
      });
    });
  });
});
