import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore, type TableTab } from "./tabStore";
import { makeTableTab, getTableTab } from "./__tests__/tabStoreTestHelpers";

describe("tabStore — preview tab system + addTab permanent option", () => {
  beforeEach(() => {
    useTabStore.setState({
      tabs: [],
      activeTabId: null,
      dirtyTabIds: new Set<string>(),
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
});
