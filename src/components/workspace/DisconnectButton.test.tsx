import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import DisconnectButton from "./DisconnectButton";
import { useConnectionStore } from "@stores/connectionStore";
import { useToastStore } from "@stores/toastStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useDataGridEditStore, entryKey } from "@stores/dataGridEditStore";
import {
  useRawQueryGridEditStore,
  rawEntryKey,
} from "@stores/rawQueryGridEditStore";
import { emptyWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";

function makeConnection(
  id: string,
  overrides?: Partial<ConnectionConfig>,
): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "test",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "rdb",
    ...overrides,
  };
}

function setStore(opts: {
  connections?: ConnectionConfig[];
  statuses?: Record<string, ConnectionStatus>;
  focusedConnId?: string | null;
  disconnectImpl?: (id: string) => Promise<void>;
}) {
  const conns = opts.connections ?? [];
  const statuses = opts.statuses ?? {};
  useConnectionStore.setState({
    connections: conns,
    activeStatuses: statuses,
    focusedConnId: opts.focusedConnId ?? null,
    ...(opts.disconnectImpl
      ? { disconnectFromDatabase: opts.disconnectImpl }
      : {}),
  });
}

function seedDirtyConnection(connId: string): void {
  useWorkspaceStore.setState({
    workspaces: {
      [connId]: { db1: { ...emptyWorkspace(), dirtyTabIds: ["t1"] } },
    },
  });
}

/**
 * Seed a pending grid edit in `dataGridEditStore` for `connId` WITHOUT a
 * corresponding `dirtyTabIds` entry — this is the inactive-tab case
 * (#1204): a tab with unsaved grid edits that isn't the mounted active
 * tab, so its `dirtyTabIds` marker was released on unmount but the pending
 * edit lives on in the store.
 */
function seedInactivePendingEdit(connId: string): void {
  useDataGridEditStore
    .getState()
    .setSlice(
      entryKey(connId, "db1", "public", "users"),
      "pendingEdits",
      new Map([["0-0", "edited"]]),
    );
}

/**
 * Issue #1204 — the raw-query result grid parks its pending edits in
 * `rawQueryGridEditStore` keyed by `(connectionId, tabId)`. An inactive query
 * tab's grid is unmounted so its `dirtyTabIds` marker is gone, but the pending
 * edit lives on. Disconnect wipes it, so the guard must see connection-wide raw
 * pending edits too — symmetric with the table-grid store seed above.
 */
function seedInactiveRawPendingEdit(connId: string): void {
  useRawQueryGridEditStore
    .getState()
    .setSlice(
      rawEntryKey(connId, "t-raw"),
      "pendingEdits",
      new Map([["0-0", "edited"]]),
    );
}

describe("DisconnectButton", () => {
  beforeEach(() => {
    setStore({});
    useToastStore.getState().clear();
    useWorkspaceStore.setState({ workspaces: {} });
    useDataGridEditStore.setState({ entries: new Map() });
    useRawQueryGridEditStore.setState({ entries: new Map() });
  });

  it("exposes an aria-label of 'Disconnect' (AC-S134-05)", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    expect(
      screen.getByRole("button", { name: "Disconnect" }),
    ).toBeInTheDocument();
  });

  it("is disabled when no connection is focused", () => {
    setStore({ focusedConnId: null });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is disabled when the focused connection is in the disconnected state", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "disconnected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is disabled while the focused connection is in the connecting state", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connecting" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toBeDisabled();
  });

  it("is enabled when the focused connection is connected", () => {
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).not.toBeDisabled();
  });

  it("calls disconnectFromDatabase with the focused id on click", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("c1");
  });

  it("surfaces a toast and re-enables the button on disconnect failure", async () => {
    const spy = vi.fn(() => Promise.reject(new Error("network down")));
    setStore({
      connections: [makeConnection("c1", { name: "Prod" })],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    await act(async () => {
      fireEvent.click(btn);
    });

    // Toast must surface the failure with variant=error.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.variant).toBe("error");
      expect(toasts[0]!.message).toMatch(/failed to disconnect/i);
      expect(toasts[0]!.message).toMatch(/Prod/);
    });

    // The button is enabled again so the user can retry.
    expect(btn).not.toBeDisabled();
  });

  it("flips aria-label to 'Disconnecting…' while a disconnect is in flight", async () => {
    let resolveDisconnect: (() => void) | null = null;
    const spy = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDisconnect = resolve;
        }),
    );
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    render(<DisconnectButton />);

    const btn = screen.getByRole("button", { name: "Disconnect" });
    act(() => {
      fireEvent.click(btn);
    });

    // While the promise is unresolved, the busy state must be visible
    // through the aria-label change.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /disconnecting/i }),
      ).toBeInTheDocument();
    });

    // Resolve and assert the busy state clears.
    await act(async () => {
      resolveDisconnect?.();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Disconnect" }),
      ).toBeInTheDocument();
    });
  });

  // #1101 — disconnect wipes the connection's tabs + pending grid edits
  // (via the store cleanup watcher). When the connection has unsaved
  // changes the click must route through the same discard confirmation as
  // the TabBar close button before tearing the adapter pool down.
  it("does not disconnect a connection with unsaved changes without confirmation (#1101)", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    seedDirtyConnection("c1");
    render(<DisconnectButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });

    expect(spy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
  });

  // #1204 — an inactive tab's pending grid edit is not in `dirtyTabIds`
  // (the marker clears on unmount) but still lives in `dataGridEditStore`.
  // Disconnect wipes it, so the guard must also see connection-wide pending
  // edits, not just the active tab's dirty marker.
  it("confirms before disconnect when only an INACTIVE tab has a pending grid edit (#1204)", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    seedInactivePendingEdit("c1"); // no dirtyTabIds entry
    render(<DisconnectButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });

    expect(spy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
  });

  // #1204 — same gap for the raw-query result grid, whose pending edits live
  // in `rawQueryGridEditStore` (tab-scoped key) rather than `dataGridEditStore`.
  it("confirms before disconnect when only an INACTIVE query tab has a pending raw edit (#1204)", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    seedInactiveRawPendingEdit("c1"); // no dirtyTabIds entry
    render(<DisconnectButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });

    expect(spy).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Discard and close" }),
    ).toBeInTheDocument();
  });

  it("disconnects after the user confirms discarding unsaved changes (#1101)", async () => {
    const spy = vi.fn(() => Promise.resolve());
    setStore({
      connections: [makeConnection("c1")],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
      disconnectImpl: spy,
    });
    seedDirtyConnection("c1");
    render(<DisconnectButton />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Discard and close" }),
      );
    });

    expect(spy).toHaveBeenCalledWith("c1");
  });

  it("renders a tooltip mentioning the focused connection's name", () => {
    setStore({
      connections: [makeConnection("c1", { name: "Prod" })],
      statuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });
    render(<DisconnectButton />);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toHaveAttribute("title", "Disconnect from Prod");
  });
});
