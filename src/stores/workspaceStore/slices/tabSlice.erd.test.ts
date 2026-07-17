// ERD is a database-level tab (`type: "erd"`), opened from the schema-tree
// header via `openErdTab(connId, db)`. The workspace bucket is already keyed
// by (connId, db), so a second open for the same database must re-focus the
// existing erd tab rather than duplicate it. These tests lock both the
// creation shape and that dedup/re-focus behavior.
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetCountersForTests,
  useWorkspaceStore,
} from "@stores/workspaceStore";

describe("tabSlice — openErdTab (database-level ERD tab)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    __resetCountersForTests();
  });

  it("opens a database-level erd tab and makes it active", () => {
    useWorkspaceStore.getState().openErdTab("conn1", "mydb");

    const ws = useWorkspaceStore.getState().workspaces.conn1!.mydb!;
    expect(ws.tabs).toHaveLength(1);
    const erd = ws.tabs[0]!;
    expect(erd.type).toBe("erd");
    if (erd.type === "erd") {
      expect(erd.connectionId).toBe("conn1");
      expect(erd.database).toBe("mydb");
      expect(erd.closable).toBe(true);
    }
    expect(ws.activeTabId).toBe(erd.id);
  });

  it("re-focuses the existing erd tab instead of opening a duplicate", () => {
    const store = useWorkspaceStore.getState();
    store.openErdTab("conn1", "mydb");
    const firstId =
      useWorkspaceStore.getState().workspaces.conn1!.mydb!.activeTabId;

    // Move focus away (a query tab becomes active), then re-open ERD for the
    // same (connId, db): dedup must reactivate the original erd tab.
    store.addQueryTab("conn1", "mydb");
    expect(
      useWorkspaceStore.getState().workspaces.conn1!.mydb!.activeTabId,
    ).not.toBe(firstId);

    store.openErdTab("conn1", "mydb");

    const ws = useWorkspaceStore.getState().workspaces.conn1!.mydb!;
    expect(ws.tabs.filter((t) => t.type === "erd")).toHaveLength(1);
    expect(ws.activeTabId).toBe(firstId);
  });

  it("keeps erd tabs isolated per database", () => {
    const store = useWorkspaceStore.getState();
    store.openErdTab("conn1", "db_a");
    store.openErdTab("conn1", "db_b");

    const wsA = useWorkspaceStore.getState().workspaces.conn1!.db_a!;
    const wsB = useWorkspaceStore.getState().workspaces.conn1!.db_b!;
    expect(wsA.tabs.filter((t) => t.type === "erd")).toHaveLength(1);
    expect(wsB.tabs.filter((t) => t.type === "erd")).toHaveLength(1);
  });
});
