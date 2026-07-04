import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { __resetDocumentQueryStoreForTests } from "@stores/documentQueryStore";
import type { DocumentQueryResult } from "@/types/document";
import { toast } from "@lib/runtime/toast";
import { useDocumentGridData } from "./useDocumentGridData";

// Issue #1269 (P1) — mongo grid browse cancel wiring. The Cancel button threads
// a `queryId` through `runFind` → `findDocuments` so the backend registers a
// cancel token AND stamps the running op with `comment == queryId`. Cancel then
// fires the cooperative `cancelQuery(queryId)` FIRST, then the native
// `cancelQueryNative(connId, 0, queryId)` which resolves the opid via
// `$currentOp` on that comment and `killOp`s it. A server rejection
// (PermissionDenied / NetworkError — e.g. no killop privilege on Atlas shared)
// surfaces via toast; `AlreadyCompleted` stays silent (finished-before-click).

vi.mock("@lib/runtime/toast", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

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
  const cancelQueryNative = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    __resetDocumentQueryStoreForTests();
    setupTauriMock({
      findDocuments: (...a: unknown[]) => findDocuments(...a),
      cancelQuery: (...a: unknown[]) => cancelQuery(...a),
      cancelQueryNative: (...a: unknown[]) => cancelQueryNative(...a),
    });
    cancelQuery.mockResolvedValue("cancelled");
    cancelQueryNative.mockResolvedValue(undefined);
  });

  async function startAndGetQueryId() {
    const d = deferred<DocumentQueryResult>();
    findDocuments.mockReturnValue(d.promise);
    const { result } = renderGrid();
    await waitFor(() => expect(findDocuments).toHaveBeenCalled());
    // queryId is the 5th positional arg (index 4) of `findDocuments`.
    const calls = findDocuments.mock.calls as unknown[][];
    const queryId = (calls[calls.length - 1] as unknown[])[4] as string;
    expect(queryId).toBeTruthy();
    return { result, queryId };
  }

  it("fires the cooperative cancel then the native killOp keyed by queryId", async () => {
    const { result, queryId } = await startAndGetQueryId();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith(queryId));
    // Native step: serverPid slot is unused for mongo (0); the tag drives it.
    await waitFor(() =>
      expect(cancelQueryNative).toHaveBeenCalledWith("conn-1", 0, queryId),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("surfaces a PermissionDenied killOp rejection via toast", async () => {
    cancelQueryNative.mockRejectedValue({
      type: "PermissionDenied",
      message: "not authorized on admin to execute command killOp",
    });
    const { result } = await startAndGetQueryId();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  });

  it("stays silent when the op already completed before the click", async () => {
    cancelQueryNative.mockRejectedValue({ type: "AlreadyCompleted" });
    const { result } = await startAndGetQueryId();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(cancelQueryNative).toHaveBeenCalled());
    expect(toast.error).not.toHaveBeenCalled();
  });
});
