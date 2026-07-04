import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { useConnectionStore } from "@stores/connectionStore";
import { __resetDocumentQueryStoreForTests } from "@stores/documentQueryStore";
import type { ConnectionConfig } from "@/types/connection";
import type { DocumentQueryResult } from "@/types/document";
import { useDocumentGridData } from "./useDocumentGridData";

// Issue #1269 (P1) — mongo grid browse cancel wiring. The Cancel button fires
// the cooperative `cancelQuery(queryId)` and, because mongo is a native-cancel
// DBMS (supportsNativeCancel → killOp), additionally resolves the opid and
// fires `cancelQueryNative`. The `queryId` threads through `runFind` →
// `findDocuments` so the backend registers a cancel token for the browse.

function seedMongoConnection(): void {
  const conn: ConnectionConfig = {
    id: "conn-1",
    name: "c",
    dbType: "mongodb",
    host: "localhost",
    port: 27017,
    user: "u",
    hasPassword: false,
    database: "app",
    groupId: null,
    color: null,
    environment: null,
    paradigm: "document",
  };
  useConnectionStore.setState({ connections: [conn] });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function renderGrid() {
  return renderHook(() =>
    useDocumentGridData({
      connectionId: "conn-1",
      database: "app",
      collection: "users",
      page: 1,
      pageSize: 100,
      activeFilter: {},
      activeFilterCount: 0,
    }),
  );
}

describe("useDocumentGridData cancel wiring (#1269)", () => {
  const findDocuments = vi.fn();
  const cancelQuery = vi.fn();
  const getQueryServerPid = vi.fn();
  const cancelQueryNative = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __resetDocumentQueryStoreForTests();
    setupTauriMock({
      findDocuments: (...a: unknown[]) => findDocuments(...a),
      cancelQuery: (...a: unknown[]) => cancelQuery(...a),
      getQueryServerPid: (...a: unknown[]) => getQueryServerPid(...a),
      cancelQueryNative: (...a: unknown[]) => cancelQueryNative(...a),
    });
    cancelQuery.mockResolvedValue("cancelled");
    cancelQueryNative.mockResolvedValue(undefined);
  });

  it("threads a queryId through findDocuments and fires cooperative + native cancel (killOp)", async () => {
    seedMongoConnection();
    const d = deferred<DocumentQueryResult>();
    findDocuments.mockReturnValue(d.promise);
    getQueryServerPid.mockResolvedValue(99001);

    const { result } = renderGrid();
    await waitFor(() => expect(findDocuments).toHaveBeenCalled());
    // queryId is the 5th positional arg (index 4) of `findDocuments`.
    const calls = findDocuments.mock.calls as unknown[][];
    const queryId = (calls[calls.length - 1] as unknown[])[4] as string;
    expect(queryId).toBeTruthy();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() =>
      expect(cancelQueryNative).toHaveBeenCalledWith("conn-1", 99001),
    );
    expect(cancelQuery).toHaveBeenCalledWith(queryId);
    expect(getQueryServerPid).toHaveBeenCalledWith(queryId);
  });

  it("skips native cancel when no opid is captured", async () => {
    seedMongoConnection();
    const d = deferred<DocumentQueryResult>();
    findDocuments.mockReturnValue(d.promise);
    getQueryServerPid.mockResolvedValue(null);

    const { result } = renderGrid();
    await waitFor(() => expect(findDocuments).toHaveBeenCalled());

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(getQueryServerPid).toHaveBeenCalled());
    expect(cancelQuery).toHaveBeenCalled();
    expect(cancelQueryNative).not.toHaveBeenCalled();
  });
});
