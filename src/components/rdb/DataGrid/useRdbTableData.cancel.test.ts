import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import type { TableData } from "@/types/schema";
import { useRdbTableData } from "./useRdbTableData";

// Issue #1269 (P1) — grid browse cancel wiring. The overlay Cancel button
// must (a) always fire the cooperative `cancelQuery(queryId)` and (b) for a
// native-cancel DBMS additionally resolve the server pid and fire
// `cancelQueryNative`. sqlite (cooperative-only) must NOT reach the native
// path. Mirrors the SQL query tab's two-step cancel (useQueryExecution).

const mockRecordHistoryEntry = vi.hoisted(() => vi.fn());
vi.mock("@lib/runtime/history/recordHistoryEntry", () => ({
  recordHistoryEntry: (...args: unknown[]) => mockRecordHistoryEntry(...args),
}));
vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));

function seedConnection(dbType: DatabaseType): void {
  const conn: ConnectionConfig = {
    id: "conn-1",
    name: "c",
    dbType,
    host: "localhost",
    port: 5432,
    user: "u",
    hasPassword: false,
    database: "db",
    groupId: null,
    color: null,
    environment: null,
    paradigm: dbType === "mongodb" ? "document" : "rdb",
  };
  useConnectionStore.setState({ connections: [conn] });
}

/** Deferred promise so the browse stays in-flight while we cancel it. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderGrid() {
  return renderHook(() =>
    useRdbTableData({
      connectionId: "conn-1",
      database: "db",
      table: "t",
      schema: "public",
      page: 1,
      pageSize: 100,
      sorts: [],
      appliedFilters: [],
      appliedRawSql: "",
    }),
  );
}

describe("useRdbTableData cancel wiring (#1269)", () => {
  const queryTableData = vi.fn();
  const cancelQuery = vi.fn();
  const getQueryServerPid = vi.fn();
  const cancelQueryNative = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupTauriMock({
      queryTableData: (...a: unknown[]) => queryTableData(...a),
      cancelQuery: (...a: unknown[]) => cancelQuery(...a),
      getQueryServerPid: (...a: unknown[]) => getQueryServerPid(...a),
      cancelQueryNative: (...a: unknown[]) => cancelQueryNative(...a),
    });
    cancelQuery.mockResolvedValue("cancelled");
    cancelQueryNative.mockResolvedValue(undefined);
  });

  it("postgres: cancel fires cooperative token then native cancel with resolved pid", async () => {
    seedConnection("postgresql");
    const d = deferred<TableData>();
    queryTableData.mockReturnValue(d.promise);
    getQueryServerPid.mockResolvedValue(4242);

    const { result } = renderGrid();

    // The mount effect kicks off the browse; wait until it is registered.
    await waitFor(() => expect(queryTableData).toHaveBeenCalled());
    // queryId is the 10th positional arg (index 9); use the latest browse
    // (a StrictMode double-invoke registers more than one).
    const calls = queryTableData.mock.calls as unknown[][];
    const queryId = (calls[calls.length - 1] as unknown[])[9] as string;
    expect(queryId).toBeTruthy();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() =>
      expect(cancelQueryNative).toHaveBeenCalledWith("conn-1", 4242),
    );
    expect(cancelQuery).toHaveBeenCalledWith(queryId);
    expect(getQueryServerPid).toHaveBeenCalledWith(queryId);
  });

  it("sqlite: cancel fires cooperative token only, never the native path", async () => {
    seedConnection("sqlite");
    const d = deferred<TableData>();
    queryTableData.mockReturnValue(d.promise);

    const { result } = renderGrid();
    await waitFor(() => expect(queryTableData).toHaveBeenCalled());
    const calls = queryTableData.mock.calls as unknown[][];
    const queryId = (calls[calls.length - 1] as unknown[])[9] as string;

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith(queryId));
    expect(getQueryServerPid).not.toHaveBeenCalled();
    expect(cancelQueryNative).not.toHaveBeenCalled();
  });

  it("native cancel is skipped when no server pid is captured (dormant backend path)", async () => {
    seedConnection("postgresql");
    const d = deferred<TableData>();
    queryTableData.mockReturnValue(d.promise);
    // Backend has not recorded a pid for the browse path — cancelQueryNative
    // must not fire with a null pid.
    getQueryServerPid.mockResolvedValue(null);

    const { result } = renderGrid();
    await waitFor(() => expect(queryTableData).toHaveBeenCalled());

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(getQueryServerPid).toHaveBeenCalled());
    expect(cancelQuery).toHaveBeenCalled();
    expect(cancelQueryNative).not.toHaveBeenCalled();
  });
});
