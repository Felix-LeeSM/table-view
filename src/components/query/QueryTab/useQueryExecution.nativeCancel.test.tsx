import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useToastStore } from "@stores/toastStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useQueryExecution } from "./useQueryExecution";
import { makeQueryTab, makeConn } from "../__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";

// Issue #1230 — native (server-side) query cancel wiring. Split into its own
// file (not folded into useQueryExecution.test.tsx) to keep that file under
// the max-lines policy.

const executeQueryMock = vi.fn();
const cancelQueryMock = vi.fn();
const cancelQueryNativeMock = vi.fn();
const getQueryServerPidMock = vi.fn();

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", dataType: "integer", category: "unknown" }],
  rows: [[1]],
  totalCount: 1,
  executionTimeMs: 3,
  queryType: "select",
};

function seedRdbTab(
  sql: string,
  overrides: Parameters<typeof makeQueryTab>[0] = {},
  connOverrides: Parameters<typeof makeConn>[0] = {},
) {
  const tab = makeQueryTab({ sql, ...overrides });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [
      makeConn({
        id: tab.connectionId,
        paradigm: "rdb",
        environment: "development",
        ...connOverrides,
      }),
    ],
  });
  return tab;
}

function getSeededRdbTab() {
  const tab = getTestWorkspace().tabs.find((t) => t.id === "query-1");
  if (!tab || tab.type !== "query") {
    throw new Error("query tab missing");
  }
  return tab;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("useQueryExecution — native cancel (#1230)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    cancelQueryMock.mockReset();
    cancelQueryNativeMock.mockReset();
    // Default: no native pid captured (a test overrides it when it needs one).
    getQueryServerPidMock.mockReset().mockResolvedValue(null);
    setupTauriMock({
      executeQuery: (...args: unknown[]) => executeQueryMock(...args),
      cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
      cancelQueryNative: (...args: unknown[]) => cancelQueryNativeMock(...args),
      getQueryServerPid: (...args: unknown[]) => getQueryServerPidMock(...args),
    });
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useHistorySettingsStore.setState({ queryHistoryEnabled: false });
    useSafeModeStore.setState({ mode: "warn" });
    useToastStore.setState({ toasts: [] });
    useSchemaStore.setState({ fileAnalyticsSources: {} });
  });

  it("records the fetched server pid on a running native-cancel query", async () => {
    getQueryServerPidMock.mockResolvedValueOnce(4242);
    const pending = deferred<QueryResult>();
    executeQueryMock.mockReturnValueOnce(pending.promise);
    const tab = seedRdbTab("SELECT pg_sleep(10)", {}, { dbType: "postgresql" });
    const { result, rerender } = renderHook(
      ({ currentTab }) => useQueryExecution({ tab: currentTab }),
      { initialProps: { currentTab: tab } },
    );

    act(() => {
      void result.current.handleExecute();
    });

    await waitFor(() => {
      expect(getSeededRdbTab().queryState.status).toBe("running");
    });
    rerender({ currentTab: getSeededRdbTab() });

    await waitFor(() => {
      const qs = getSeededRdbTab().queryState;
      if (qs.status !== "running") throw new Error("not running");
      expect(qs.serverPid).toBe(4242);
    });
    const runningQueryId = executeQueryMock.mock.calls[0]?.[2];
    expect(getQueryServerPidMock).toHaveBeenCalledWith(runningQueryId);

    await act(async () => {
      pending.resolve(SELECT_RESULT);
    });
  });

  it("fires native cancel with the captured pid for a supported DBMS", async () => {
    const tab = seedRdbTab(
      "SELECT pg_sleep(10)",
      {
        queryState: {
          status: "running",
          queryId: "query-1-9999",
          serverPid: 5150,
        },
      },
      { dbType: "postgresql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(cancelQueryNativeMock).toHaveBeenCalledWith("conn1", 5150);
    // The cooperative token still fires — double-firing is harmless.
    expect(cancelQueryMock).toHaveBeenCalledWith("query-1-9999");
  });

  it("falls back to cooperative-only cancel when no pid was captured", async () => {
    const tab = seedRdbTab(
      "SELECT pg_sleep(10)",
      { queryState: { status: "running", queryId: "query-1-8888" } },
      { dbType: "postgresql" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(cancelQueryNativeMock).not.toHaveBeenCalled();
    expect(cancelQueryMock).toHaveBeenCalledWith("query-1-8888");
  });

  it("never fires native cancel for a DBMS without a native path", async () => {
    const tab = seedRdbTab(
      "SELECT 1",
      {
        queryState: {
          status: "running",
          queryId: "query-1-7777",
          // Even a stray pid must not fire for an sqlite tab.
          serverPid: 1,
        },
      },
      { dbType: "sqlite" },
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    expect(cancelQueryNativeMock).not.toHaveBeenCalled();
    expect(cancelQueryMock).toHaveBeenCalledWith("query-1-7777");
  });
});
