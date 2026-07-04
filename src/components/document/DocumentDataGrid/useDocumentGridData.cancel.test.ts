import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { __resetDocumentQueryStoreForTests } from "@stores/documentQueryStore";
import type { DocumentQueryResult } from "@/types/document";
import { useDocumentGridData } from "./useDocumentGridData";

// Issue #1269 (P1) — mongo grid browse cancel wiring. The Cancel button
// threads a `queryId` through `runFind` → `findDocuments` so the backend
// registers a cancel token, then fires the cooperative `cancelQuery(queryId)`.
// Mongo has NO native (server-side) cancel wired yet: `killOp` exists but no
// execution path materialises the running op's opid, so the grid stays
// cooperative-only (see `supportsNativeCancel`). The native step lands with
// the opid-capture follow-up.

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
  });

  it("threads a queryId through findDocuments and fires the cooperative cancel", async () => {
    const d = deferred<DocumentQueryResult>();
    findDocuments.mockReturnValue(d.promise);

    const { result } = renderGrid();
    await waitFor(() => expect(findDocuments).toHaveBeenCalled());
    // queryId is the 5th positional arg (index 4) of `findDocuments`.
    const calls = findDocuments.mock.calls as unknown[][];
    const queryId = (calls[calls.length - 1] as unknown[])[4] as string;
    expect(queryId).toBeTruthy();

    await act(async () => {
      result.current.handleCancelRefetch();
    });

    await waitFor(() => expect(cancelQuery).toHaveBeenCalledWith(queryId));
    // Mongo has no native cancel wired — the killOp path must not be reached.
    expect(cancelQueryNative).not.toHaveBeenCalled();
  });
});
