// TabDbChip — the tab-local database selector for a Mongo query tab.
//
// The display-only chip was replaced by an interactive selector after the
// user asked for the lock to be lifted ("you can't even pick a
// database"), which changed the chip's behaviour completely. This suite
// guards the new contract:
//
//   1. The database label is exposed as the chip text.
//   2. Even when database === "", the affordance does not disappear and
//      the chip renders "(no database)" itself (the old self-hide
//      behaviour is dropped — that was the exact symptom the user
//      reported as "can't pick one").
//   3. Click → popover opens → `listDatabases(connectionId)` is called.
//   4. Picking an item → `setQueryTabDatabase(connId, db, tabId, target)`
//      is called.

import {
  resetFakeWindowConnectionId,
  setFakeWindowConnectionId,
} from "@stores/__tests__/fakeWindowConnectionId";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import TabDbChip from "./TabDbChip";

vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: vi.fn(async () => [{ name: "admin" }, { name: "analytics" }]),
}));

vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { listDatabases } from "@/lib/api/listDatabases";

describe("TabDbChip — interactive database selector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      focusedConnId: "conn-mongo",
      activeStatuses: {
        "conn-mongo": { type: "connected", activeDb: "analytics" },
      },
    });
    useWorkspaceStore.setState({ workspaces: {} });
    // TabDbChip uses `useCurrentWorkspaceKey()`, which resolves `connId`
    // from the Tauri window label. Stub the label so the chip can write
    // to the (`conn-mongo`, `analytics`) workspace slot under test.
    setFakeWindowConnectionId("conn-mongo");
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
    cleanup();
  });

  it("renders the database label as the chip text", () => {
    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );
    expect(
      screen.getByRole("button", { name: /current database: analytics/i }),
    ).toHaveTextContent("analytics");
  });

  it("renders an actionable placeholder when the database is empty", () => {
    // The display-only chip self-hid when database was "". That produced
    // the exact symptom the user complained about: "you can't even pick a
    // database." The new contract keeps the affordance visible so the
    // user always has a clickable surface to set a database.
    //
    // Mongo db-contract α: the label changed from "(select database)" to
    // "(no database)" so the chip reflects the *binding* (none), not a
    // nag-CTA. Admin commands run without one; collection commands
    // surface a separate error.
    render(<TabDbChip tabId="query-1" database="" connectionId="conn-mongo" />);
    const trigger = screen.getByRole("button", {
      name: /no database bound/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/no database/i);
  });

  it("fetches the database list on click and renders the entries", async () => {
    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /current database: analytics/i }),
    );

    await waitFor(() => {
      expect(listDatabases).toHaveBeenCalledWith("conn-mongo");
    });
    expect(await screen.findByRole("option", { name: "admin" })).toBeVisible();
    expect(screen.getByRole("option", { name: "analytics" })).toBeVisible();
  });

  it("selecting an entry dispatches setQueryTabDatabase against the current workspace", async () => {
    // Seed the workspace at (conn-mongo, analytics) so the action has
    // something to patch. `useCurrentWorkspaceKey()` will resolve this
    // pair from the connectionStore seeding in beforeEach.
    useWorkspaceStore.setState({
      workspaces: {
        "conn-mongo": {
          analytics: {
            tabs: [
              {
                type: "query",
                id: "query-1" as TabId,
                title: "Query 1",
                connectionId: "conn-mongo" as ConnectionId,
                closable: true,
                sql: "",
                queryState: { status: "idle" },
                paradigm: "document",
                database: "analytics",
              },
            ],
            activeTabId: "query-1",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    });

    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /current database: analytics/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "admin" }));

    await waitFor(() => {
      const tab =
        useWorkspaceStore.getState().workspaces["conn-mongo"]?.analytics
          ?.tabs[0];
      expect(tab && tab.type === "query" && tab.database).toBe("admin");
    });
  });
});
