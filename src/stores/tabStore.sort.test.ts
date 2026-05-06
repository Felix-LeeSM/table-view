import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, type TableTab } from "./tabStore";
import type { SortInfo } from "@/types/schema";
import {
  makeTableTab,
  getTableTab,
  getQueryTab,
} from "./__tests__/tabStoreTestHelpers";

describe("tabStore — moveTab + reopen + per-tab sort state", () => {
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
});
