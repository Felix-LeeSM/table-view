// Issue #1102 — the raw-query grid parks its pending edits in
// `rawQueryGridEditStore` keyed by `(connectionId, tabId)`. Two teardown
// paths must purge that store or the edits leak in memory:
//   - `removeTab` when a query tab closes (tab-exclusive key → unconditional).
//   - `clearForConnection` when a connection is dropped. NOTE: HomePage's
//     `handleActivate` calls `clearForConnection` directly, bypassing
//     `cleanupConnectionFrontendState`, so the raw purge must live in the
//     slice itself — this is the T5/A1 regression these tests lock.
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  useRawQueryGridEditStore,
  rawEntryKey,
  EMPTY_RAW_ENTRY,
} from "@stores/rawQueryGridEditStore";
import type { QueryTab, WorkspaceState } from "../types";
import type { ConnectionId, TabId } from "@/types/branded";

function makeQueryTab({
  id = "q1",
  ...overrides
}: Partial<Omit<QueryTab, "id">> & { id?: string } = {}): QueryTab {
  return {
    type: "query",
    id: id as TabId,
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT 1",
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
    sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
    ...overrides,
  };
}

function seedRawPending(connId: string, tabId: string): void {
  useRawQueryGridEditStore
    .getState()
    .setSlice(
      rawEntryKey(connId as ConnectionId, tabId as TabId),
      "pendingEdits",
      new Map([["0-1", "x"]]),
    );
}

describe("tabSlice — Issue #1102 rawQueryGridEditStore purge wiring", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useRawQueryGridEditStore.setState({ entries: new Map() });
  });

  it("removeTab purges the closing query tab's raw pending entry", () => {
    const tab = makeQueryTab({ id: "q1", connectionId: "conn1" });
    useWorkspaceStore.setState({
      workspaces: {
        conn1: { db1: makeWorkspace({ tabs: [tab], activeTabId: "q1" }) },
      },
    });
    seedRawPending("conn1", "q1");
    expect(
      useRawQueryGridEditStore
        .getState()
        .getEntry(rawEntryKey("conn1" as ConnectionId, "q1" as TabId))
        .pendingEdits.size,
    ).toBe(1);

    useWorkspaceStore.getState().removeTab("conn1", "db1", "q1");

    expect(
      useRawQueryGridEditStore
        .getState()
        .getEntry(rawEntryKey("conn1" as ConnectionId, "q1" as TabId)),
    ).toBe(EMPTY_RAW_ENTRY);
  });

  it("clearForConnection purges every raw pending entry for that connection", () => {
    useWorkspaceStore.setState({
      workspaces: {
        conn1: {
          db1: makeWorkspace({
            tabs: [makeQueryTab({ id: "q1" }), makeQueryTab({ id: "q2" })],
            activeTabId: "q1",
          }),
        },
      },
    });
    seedRawPending("conn1", "q1");
    seedRawPending("conn1", "q2");
    seedRawPending("conn2", "q9"); // different connection — must survive.

    useWorkspaceStore.getState().clearForConnection("conn1");

    const raw = useRawQueryGridEditStore.getState();
    expect(
      raw.getEntry(rawEntryKey("conn1" as ConnectionId, "q1" as TabId)),
    ).toBe(EMPTY_RAW_ENTRY);
    expect(
      raw.getEntry(rawEntryKey("conn1" as ConnectionId, "q2" as TabId)),
    ).toBe(EMPTY_RAW_ENTRY);
    expect(
      raw.getEntry(rawEntryKey("conn2" as ConnectionId, "q9" as TabId))
        .pendingEdits.size,
    ).toBe(1);
  });
});
