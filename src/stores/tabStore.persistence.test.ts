import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useTabStore } from "./tabStore";
import type { SortInfo } from "@/types/schema";
import {
  makeTableTab,
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/tabStoreTestHelpers";

describe("tabStore — persistence (Sprint 38 + 66 + 76 + 129)", () => {
  // -- Sprint 38: Tab State Persistence --

  describe("tab state persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        dirtyTabIds: new Set<string>(),
      });
      const ref = installFakeLocalStorage();
      storage = ref.storage;
    });

    afterEach(() => {
      restoreLocalStorage();
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

  // -- Sprint 76: sort persistence + legacy migration --

  describe("per-tab sort persistence", () => {
    let storage: Record<string, string>;

    beforeEach(() => {
      useTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
      });
      const ref = installFakeLocalStorage();
      storage = ref.storage;
    });

    afterEach(() => {
      restoreLocalStorage();
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
});
