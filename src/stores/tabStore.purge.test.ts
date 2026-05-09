// Sprint 251 — `tabStore.removeTab` / `clearTabsForConnection` wire-up
// to `dataGridEditStore`. Maps to AC-251-T1..T3 from
// `docs/sprints/sprint-251/contract.md`. Date 2026-05-09.
//
// The store entry that lives behind a (connectionId, schema, table) key
// must be purged when no remaining tab targets the same key, AND when a
// connection is dropped wholesale. But removing one of two tabs that
// share a key (e.g. preview + persistent) must NOT purge — the surviving
// tab still depends on that pending state.
import { describe, it, expect, beforeEach } from "vitest";
import { useTabStore } from "./tabStore";
import { useDataGridEditStore, entryKey } from "./dataGridEditStore";
import { makeTableTab } from "./__tests__/tabStoreTestHelpers";

function resetStores(): void {
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
  useDataGridEditStore.setState({ entries: new Map() });
}

describe("tabStore — Sprint 251 dataGridEditStore purge wire-up", () => {
  beforeEach(() => {
    resetStores();
  });

  it("[AC-251-T1] removeTab purges the store entry when no other tab shares the same (connectionId, schema, table) key", () => {
    useTabStore.getState().addTab(
      makeTableTab({
        connectionId: "conn1",
        schema: "public",
        table: "users",
      }),
    );
    const tabId = useTabStore.getState().tabs[0]!.id;

    // Seed a pending edit on that tab's store entry.
    const key = entryKey("conn1", "public", "users");
    useDataGridEditStore
      .getState()
      .setSlice(key, "pendingEdits", new Map([["0-1", "Alicia"]]));
    expect(useDataGridEditStore.getState().entries.has(key)).toBe(true);

    useTabStore.getState().removeTab(tabId);

    expect(useDataGridEditStore.getState().entries.has(key)).toBe(false);
  });

  it("[AC-251-T2] removeTab does NOT purge when another tab still targets the same key (preview + persistent share state)", () => {
    // First tab — created as preview.
    useTabStore.getState().addTab(
      makeTableTab({
        connectionId: "conn1",
        schema: "public",
        table: "users",
      }),
    );
    // Second tab — same (connectionId, schema, table), permanent so it
    // doesn't replace the preview slot.
    useTabStore.getState().addTab({
      ...makeTableTab({
        connectionId: "conn1",
        schema: "public",
        table: "users",
      }),
      permanent: true,
    });

    // The store-level keying is per-(cid, schema, table), so even with
    // the preview-replace logic we need at least 2 distinct tab ids
    // pointing at the same key. Seed both manually if needed.
    const tabs = useTabStore.getState().tabs;
    expect(tabs.length).toBeGreaterThanOrEqual(1);

    const key = entryKey("conn1", "public", "users");
    useDataGridEditStore
      .getState()
      .setSlice(key, "pendingEdits", new Map([["0-1", "Alicia"]]));

    // Force-add a second tab pointing at the same table by setState so we
    // bypass the preview-replace logic, which is orthogonal to the purge
    // contract under test here.
    useTabStore.setState((state) => ({
      tabs: [
        ...state.tabs,
        {
          type: "table" as const,
          id: "extra-tab",
          title: "users (extra)",
          connectionId: "conn1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records" as const,
        },
      ],
    }));

    const firstTabId = useTabStore.getState().tabs[0]!.id;

    useTabStore.getState().removeTab(firstTabId);

    // The other tab still uses this key — the entry must survive.
    expect(useDataGridEditStore.getState().entries.has(key)).toBe(true);
    const entry = useDataGridEditStore.getState().getEntry(key);
    expect(entry.pendingEdits.get("0-1")).toBe("Alicia");
  });

  it("[AC-251-T3] clearTabsForConnection purges every store entry whose key starts with the connectionId prefix", () => {
    // Two tabs on conn1 (different tables), one tab on conn2.
    useTabStore.getState().addTab(
      makeTableTab({
        connectionId: "conn1",
        schema: "public",
        table: "users",
      }),
    );
    useTabStore.getState().addTab(
      makeTableTab({
        connectionId: "conn1",
        schema: "public",
        table: "orders",
      }),
    );
    useTabStore.getState().addTab(
      makeTableTab({
        connectionId: "conn2",
        schema: "public",
        table: "users",
      }),
    );

    const keyA = entryKey("conn1", "public", "users");
    const keyB = entryKey("conn1", "public", "orders");
    const keyOther = entryKey("conn2", "public", "users");

    useDataGridEditStore
      .getState()
      .setSlice(keyA, "pendingEdits", new Map([["0-1", "a"]]));
    useDataGridEditStore
      .getState()
      .setSlice(keyB, "pendingEdits", new Map([["0-1", "b"]]));
    useDataGridEditStore
      .getState()
      .setSlice(keyOther, "pendingEdits", new Map([["0-1", "other"]]));

    useTabStore.getState().clearTabsForConnection("conn1");

    const entries = useDataGridEditStore.getState().entries;
    expect(entries.has(keyA)).toBe(false);
    expect(entries.has(keyB)).toBe(false);
    expect(entries.has(keyOther)).toBe(true);
  });
});
