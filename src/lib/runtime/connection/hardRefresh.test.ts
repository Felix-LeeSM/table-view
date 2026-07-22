import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { connectToDatabase, disconnectFromDatabase } from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  buildRunningQueryWorkspaceState,
  getQueryTab,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useHardRefresh } from "./hardRefresh";

// #1719 (Part of #1717) — Stage 2 hard refresh orchestration. The single
// `hardRefreshConnection` callback must, for one connection id and in order:
//   1. abandon its in-flight / completed query results (running tabs → idle),
//   2. tear the session down (RAW `disconnect`, so the connection store never
//      sees a `disconnected` transition that would drop this window's tabs),
//   3. rebuild the session (`connect`) and invalidate the schema cache,
//   4. refetch via the Stage 1 window events.
// Boundary mock: only the `@lib/tauri` connect/disconnect IPCs are stubbed
// (globally provided by the tauri mock); the stores run for real so the
// assertions read user-facing invariants, not mock call shapes.

const connectMock = vi.mocked(connectToDatabase);
const disconnectMock = vi.mocked(disconnectFromDatabase);

describe("useHardRefresh (#1719, Part of #1717)", () => {
  beforeEach(() => {
    connectMock.mockReset().mockResolvedValue(undefined);
    disconnectMock.mockReset().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [], activeStatuses: {} });
    useSchemaStore.setState((s) => ({
      databases: { ...s.databases, conn1: [] },
    }));
  });

  afterEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("reconnects (disconnect before connect), resets query state to idle, invalidates the schema cache, and refetches", async () => {
    useWorkspaceStore.setState(
      buildRunningQueryWorkspaceState("q1", "q1-1", "conn1", "db1"),
    );
    const events: string[] = [];
    const record = (e: Event) => events.push(e.type);
    window.addEventListener("refresh-data", record);
    window.addEventListener("refresh-structure", record);
    window.addEventListener("refresh-schema", record);

    const { result } = renderHook(() => useHardRefresh());
    await act(async () => {
      await result.current("conn1");
    });

    window.removeEventListener("refresh-data", record);
    window.removeEventListener("refresh-structure", record);
    window.removeEventListener("refresh-schema", record);

    // Reconnect: raw disconnect strictly before the rebuild connect.
    expect(disconnectMock).toHaveBeenCalledWith("conn1");
    expect(connectMock).toHaveBeenCalledWith("conn1");
    expect(disconnectMock.mock.invocationCallOrder[0]).toBeLessThan(
      connectMock.mock.invocationCallOrder[0]!,
    );

    // The running query result is abandoned (intended loss on hard refresh).
    expect(getQueryTab(getTestWorkspace("conn1", "db1"), 0).queryState).toEqual(
      { status: "idle" },
    );

    // Schema cache for the connection is invalidated.
    expect(useSchemaStore.getState().databases.conn1).toBeUndefined();

    // Refetch fires all three Stage 1 events after the reconnect.
    expect(events).toEqual([
      "refresh-data",
      "refresh-structure",
      "refresh-schema",
    ]);
  });

  it("does not touch the connection store's disconnect action (would drop this window's tabs)", async () => {
    useWorkspaceStore.setState(
      buildRunningQueryWorkspaceState("q1", "q1-1", "conn1", "db1"),
    );
    const storeDisconnectSpy = vi.spyOn(
      useConnectionStore.getState(),
      "disconnectFromDatabase",
    );

    const { result } = renderHook(() => useHardRefresh());
    await act(async () => {
      await result.current("conn1");
    });

    // The store disconnect flips activeStatuses → "disconnected", which the
    // cleanup subscribe turns into a tab purge. Hard refresh must reconnect
    // via the raw IPC boundary instead so the open tabs survive.
    expect(storeDisconnectSpy).not.toHaveBeenCalled();
    expect(getTestWorkspace("conn1", "db1").tabs).toHaveLength(1);
  });

  it("skips the refetch when the reconnect fails", async () => {
    useConnectionStore.setState({
      connections: [],
      activeStatuses: { conn1: { type: "connected", activeDb: "db1" } },
    });
    // A rejecting connect leaves the connection-store status on "error", so
    // there is no live pool to refetch against.
    connectMock.mockRejectedValue(new Error("connect failed"));
    const refetch = vi.fn();
    window.addEventListener("refresh-data", refetch);

    const { result } = renderHook(() => useHardRefresh());
    await act(async () => {
      await result.current("conn1");
    });

    window.removeEventListener("refresh-data", refetch);

    expect(refetch).not.toHaveBeenCalled();
  });
});
