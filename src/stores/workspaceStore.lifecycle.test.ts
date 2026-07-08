/**
 * `workspaceStore` lifecycle axis. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors covered (in TDD increment order from sprint-262/spec.md):
 *   1. Tracer bullet: `addTab(connId, init)` → workspaces[connId][db].tabs
 *      holds one tab + activeTabId === tab.id.
 *   2..: multi-DB isolation, closeTab, setActiveTab, clearForConnection.
 *      Extended in subsequent increments — kept in this file (lifecycle
 *      axis) per the tabStore.lifecycle.test.ts precedent.
 *
 * Author intent (2026-05-12): vertical slice. One test → minimal store
 * code → next test. No batch test authoring.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { entryKey, useDataGridEditStore } from "./dataGridEditStore";
import { useWorkspaceStore } from "./workspaceStore";
import type { QueryTab, TableTabInit } from "./workspaceStore/types";

function makeTableInit(overrides: Partial<TableTabInit> = {}): TableTabInit {
  return {
    type: "table",
    title: "users",
    connectionId: "conn1",
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    database: "dbA",
    ...overrides,
  };
}

describe("workspaceStore — lifecycle", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useDataGridEditStore.setState({ entries: new Map() });
  });

  it("tracer bullet — addTab puts the tab into workspaces[connId][db] and sets activeTabId", () => {
    useWorkspaceStore.getState().addTab("conn1", makeTableInit());

    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect(ws!.tabs[0]!.type).toBe("table");
    expect(ws!.activeTabId).toBe(ws!.tabs[0]!.id);
  });

  it("isolates tabs per (connId, db) — addTab to dbA then dbB keeps each workspace's tabs independent", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({ database: "dbA", table: "users", title: "users" }),
    );
    store.addTab(
      "conn1",
      makeTableInit({ database: "dbB", table: "orders", title: "orders" }),
    );

    const { workspaces } = useWorkspaceStore.getState();
    const dbA = workspaces["conn1"]?.["dbA"];
    const dbB = workspaces["conn1"]?.["dbB"];

    expect(dbA).toBeDefined();
    expect(dbB).toBeDefined();
    expect(dbA!.tabs).toHaveLength(1);
    expect(dbB!.tabs).toHaveLength(1);
    expect((dbA!.tabs[0] as { table?: string }).table).toBe("users");
    expect((dbB!.tabs[0] as { table?: string }).table).toBe("orders");
    expect(dbA!.activeTabId).toBe(dbA!.tabs[0]!.id);
    expect(dbB!.activeTabId).toBe(dbB!.tabs[0]!.id);
  });

  it("removeTab — closing active tab promotes the last remaining tab", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "users",
        title: "users",
        permanent: true,
      }),
    );
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "orders",
        title: "orders",
        permanent: true,
      }),
    );

    const tabsBefore =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs;
    const activeId = tabsBefore[1]!.id;
    expect(
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.activeTabId,
    ).toBe(activeId);

    useWorkspaceStore.getState().removeTab("conn1", "dbA", activeId);

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.tabs).toHaveLength(1);
    expect(ws.activeTabId).toBe(ws.tabs[0]!.id);
  });

  it("removeTab — closing the last tab leaves activeTabId null", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({ database: "dbA", table: "users", title: "users" }),
    );

    const tabId =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs[0]!.id;
    useWorkspaceStore.getState().removeTab("conn1", "dbA", tabId);

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.tabs).toHaveLength(0);
    expect(ws.activeTabId).toBeNull();
  });

  it("setActiveTab — switches activeTabId within the same (connId, db) workspace", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "users",
        title: "users",
        permanent: true,
      }),
    );
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "orders",
        title: "orders",
        permanent: true,
      }),
    );

    const tabs = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs;
    const firstId = tabs[0]!.id;
    const secondId = tabs[1]!.id;
    expect(
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.activeTabId,
    ).toBe(secondId);

    useWorkspaceStore.getState().setActiveTab("conn1", "dbA", firstId);

    expect(
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.activeTabId,
    ).toBe(firstId);
  });

  it("setActiveTab — does not leak across workspaces (different db unchanged)", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({ database: "dbA", table: "users", title: "users" }),
    );
    store.addTab(
      "conn1",
      makeTableInit({ database: "dbB", table: "orders", title: "orders" }),
    );

    const dbBActiveBefore =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbB"]!.activeTabId;
    const dbATabId =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs[0]!.id;

    useWorkspaceStore.getState().setActiveTab("conn1", "dbA", dbATabId);

    const dbBActiveAfter =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbB"]!.activeTabId;
    expect(dbBActiveAfter).toBe(dbBActiveBefore);
  });

  it("clearForConnection — drops every workspace under that connId and leaves siblings intact", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({
        connectionId: "conn1",
        database: "dbA",
        table: "users",
        title: "users",
      }),
    );
    store.addTab(
      "conn1",
      makeTableInit({
        connectionId: "conn1",
        database: "dbB",
        table: "orders",
        title: "orders",
      }),
    );
    store.addTab(
      "conn2",
      makeTableInit({
        connectionId: "conn2",
        database: "dbA",
        table: "people",
        title: "people",
      }),
    );

    useWorkspaceStore.getState().clearForConnection("conn1");

    const { workspaces } = useWorkspaceStore.getState();
    expect(workspaces["conn1"]).toBeUndefined();
    expect(workspaces["conn2"]).toBeDefined();
    expect(workspaces["conn2"]!["dbA"]!.tabs).toHaveLength(1);
  });

  it("clearForConnection — unknown connId is a no-op (preserves identity)", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({ connectionId: "conn1", database: "dbA" }),
    );

    const before = useWorkspaceStore.getState().workspaces;
    useWorkspaceStore.getState().clearForConnection("does-not-exist");
    const after = useWorkspaceStore.getState().workspaces;

    expect(after).toBe(before);
  });

  it("removeTab — non-active tab close keeps activeTabId pointed at the still-active tab", () => {
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "users",
        title: "users",
        permanent: true,
      }),
    );
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "orders",
        title: "orders",
        permanent: true,
      }),
    );

    const tabs = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs;
    const inactiveId = tabs[0]!.id;
    const activeId = tabs[1]!.id;

    useWorkspaceStore.getState().removeTab("conn1", "dbA", inactiveId);

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.tabs).toHaveLength(1);
    expect(ws.tabs[0]!.id).toBe(activeId);
    expect(ws.activeTabId).toBe(activeId);
  });

  it("[RISK-039] removeTab purges only the closing database's pending edit key", () => {
    // Reason: Sprint 433 RISK-039 — same conn/schema/table can be open in
    // dbA and dbB; closing dbA must not discard dbB pending edits.
    // (2026-05-22)
    const store = useWorkspaceStore.getState();
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbA",
        table: "users",
        title: "users",
        permanent: true,
      }),
    );
    store.addTab(
      "conn1",
      makeTableInit({
        database: "dbB",
        table: "users",
        title: "users",
        permanent: true,
      }),
    );

    const dbATabId =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.tabs[0]!.id;
    const dbAKey = entryKey("conn1", "dbA", "public", "users");
    const dbBKey = entryKey("conn1", "dbB", "public", "users");
    useDataGridEditStore
      .getState()
      .setSlice(dbAKey, "pendingEdits", new Map([["0-1", "dbA edit"]]));
    useDataGridEditStore
      .getState()
      .setSlice(dbBKey, "pendingEdits", new Map([["0-1", "dbB edit"]]));

    useWorkspaceStore.getState().removeTab("conn1", "dbA", dbATabId);

    const entries = useDataGridEditStore.getState().entries;
    expect(entries.has(dbAKey)).toBe(false);
    expect(entries.get(dbBKey)?.pendingEdits.get("0-1")).toBe("dbB edit");
  });

  // Sprint 353 (AC-353-05, 2026-05-16) — in-memory closedTabHistory cap
  // was 20; Q19 raises it to 25 so the dehydration cap and the in-memory
  // cap agree (newest-first, oldest dropped on overflow).
  it("AC-353-05 — caps in-memory closedTabHistory at 25 entries; the 26th close drops the oldest", () => {
    const store = useWorkspaceStore.getState();
    // Add 26 tabs to the same workspace so we can close them one by one.
    const ids: string[] = [];
    for (let i = 0; i < 26; i += 1) {
      // `permanent: true` skips preview-slot replacement so each call
      // appends a fresh tab; otherwise `addTab` reuses the single
      // preview slot for the same (connectionId, subView) and we'd end
      // up with one tab regardless of how many calls were made.
      store.addTab(
        "conn1",
        makeTableInit({
          table: `t${i}`,
          title: `t${i}`,
          permanent: true,
        }),
      );
      const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
      ids.push(ws!.tabs[ws!.tabs.length - 1]!.id);
    }

    // Close in insertion order. After 26 closes the history should have
    // dropped the very first one (oldest) and kept the most recent 25.
    for (const id of ids) {
      useWorkspaceStore.getState().removeTab("conn1", "dbA", id);
    }

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.closedTabHistory).toHaveLength(25);
    // Newest-first: index 0 is the most recently closed (id[25]).
    expect(ws.closedTabHistory[0]!.id).toBe(ids[25]);
    // The oldest survivor is id[1]; id[0] was evicted as the 26th overflow.
    expect(ws.closedTabHistory[24]!.id).toBe(ids[1]);
  });

  // Issue #1088 — closing a query tab mid-run then reopening it left a
  // permanent "running" ghost: removeTab pushed the live queryState into
  // closedTabHistory and reopenLastClosedTab restored it verbatim, so the
  // completion callback (targeting the old tabId) never reached the new tab.
  // Fix: history never holds a live queryState — sanitize to idle on push.
  it("#1088 — closing a running query tab and reopening restores it as idle", () => {
    const store = useWorkspaceStore.getState();
    store.addQueryTab("conn1", "dbA", { title: "run", sql: "SELECT 1" });
    const opened = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    const tabId = opened.tabs[0]!.id;

    // Drive the tab into a running state (query in flight).
    store.updateQueryState("conn1", "dbA", tabId, {
      status: "running",
      queryId: "qexec-1",
    });
    store.removeTab("conn1", "dbA", tabId);

    // History must not carry the live running state.
    const afterClose =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(afterClose.closedTabHistory[0]!.type).toBe("query");
    expect((afterClose.closedTabHistory[0] as QueryTab).queryState).toEqual({
      status: "idle",
    });

    store.reopenLastClosedTab("conn1", "dbA");

    const reopenedWs =
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    const reopened = reopenedWs.tabs[reopenedWs.tabs.length - 1] as QueryTab;
    expect(reopened.type).toBe("query");
    expect(reopened.queryState).toEqual({ status: "idle" });
    expect(reopened.sql).toBe("SELECT 1"); // SQL text preserved.
  });

  // Issue #1057 — updateQueryState stamps `startedAt` (ms epoch) the moment a
  // query enters the running state, giving the elapsed timer an anchor that
  // survives tab switches. setRunningQueryServerPid must preserve it when the
  // native pid arrives a beat later.
  describe("#1057 — running-state startedAt stamping", () => {
    function addRunningTab() {
      const store = useWorkspaceStore.getState();
      store.addQueryTab("conn1", "dbA", { title: "run", sql: "SELECT 1" });
      const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
      return ws.tabs[0]!.id;
    }

    it("stamps startedAt when entering running via updateQueryState", () => {
      const tabId = addRunningTab();
      const before = Date.now();
      useWorkspaceStore.getState().updateQueryState("conn1", "dbA", tabId, {
        status: "running",
        queryId: "q-1057",
      });
      const after = Date.now();
      const state = (
        useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!
          .tabs[0] as QueryTab
      ).queryState;
      expect(state.status).toBe("running");
      if (state.status !== "running") throw new Error("expected running");
      expect(state.startedAt).toBeGreaterThanOrEqual(before);
      expect(state.startedAt).toBeLessThanOrEqual(after);
    });

    it("preserves startedAt across setRunningQueryServerPid", () => {
      const tabId = addRunningTab();
      useWorkspaceStore.getState().updateQueryState("conn1", "dbA", tabId, {
        status: "running",
        queryId: "q-1057",
      });
      const stamped = (
        useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!
          .tabs[0] as QueryTab
      ).queryState;
      if (stamped.status !== "running") throw new Error("expected running");
      const anchor = stamped.startedAt;

      useWorkspaceStore
        .getState()
        .setRunningQueryServerPid("conn1", "dbA", tabId, "q-1057", 4242);

      const after = (
        useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!
          .tabs[0] as QueryTab
      ).queryState;
      expect(after.status).toBe("running");
      if (after.status !== "running") throw new Error("expected running");
      expect(after.serverPid).toBe(4242);
      expect(after.startedAt).toBe(anchor); // not reset
    });
  });
});
