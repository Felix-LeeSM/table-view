import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-05 — AC-148-4 retirement. connect/disconnect must invalidate the
// schema/document caches together, or the re-entered screen wrongly shows a
// stale schema as the "initial DB" (plan:
// connections-window-connection-nifty-meerkat.md). Right after the connect
// store action, the hook clears the schema and document caches with the same
// connectionId.

const {
  mockConnect,
  mockDisconnect,
  mockClearConnectionSchemaCache,
  mockClearDocumentCatalog,
  mockClearDocumentQuery,
  mockGetState,
} = vi.hoisted(() => ({
  mockConnect: vi.fn(() => Promise.resolve()),
  mockDisconnect: vi.fn(() => Promise.resolve()),
  mockClearConnectionSchemaCache: vi.fn(),
  mockClearDocumentCatalog: vi.fn(),
  mockClearDocumentQuery: vi.fn(),
  mockGetState: vi.fn(() => ({
    activeStatuses: { c1: { type: "connected" } } as Record<
      string,
      { type: string }
    >,
  })),
}));

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        connectToDatabase: mockConnect,
        disconnectFromDatabase: mockDisconnect,
      }),
    { getState: mockGetState },
  ),
}));

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: (selector: (s: unknown) => unknown) =>
    selector({ clearForConnection: mockClearConnectionSchemaCache }),
}));

vi.mock("@stores/documentCatalogStore", () => ({
  useDocumentCatalogStore: (selector: (s: unknown) => unknown) =>
    selector({ clearConnection: mockClearDocumentCatalog }),
}));

vi.mock("@stores/documentQueryStore", () => ({
  useDocumentQueryStore: (selector: (s: unknown) => unknown) =>
    selector({ clearConnection: mockClearDocumentQuery }),
}));

import { useConnectionLifecycle } from "./useConnectionLifecycle";

describe("useConnectionLifecycle", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockDisconnect.mockClear();
    mockClearConnectionSchemaCache.mockClear();
    mockClearDocumentCatalog.mockClear();
    mockClearDocumentQuery.mockClear();
    mockGetState.mockReturnValue({
      activeStatuses: { c1: { type: "connected" } },
    });
  });

  it("connect: backend connect 성공 후 두 cache를 같은 id로 clear하고 true를 반환한다", async () => {
    const { result } = renderHook(() => useConnectionLifecycle());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.connect("c1");
    });
    expect(mockConnect).toHaveBeenCalledWith("c1");
    expect(mockClearConnectionSchemaCache).toHaveBeenCalledWith("c1");
    expect(mockClearDocumentCatalog).toHaveBeenCalledWith("c1");
    expect(mockClearDocumentQuery).toHaveBeenCalledWith("c1");
    expect(returned).toBe(true);
  });

  it("connect: backend가 error status를 기록하면 false를 반환한다", async () => {
    // 2026-05-05 — connectionStore.connectToDatabase records the status as
    // the error variant instead of throwing. A caller cannot tell success
    // from the await alone, so the hook reads the fresh status and turns it
    // into a boolean.
    mockGetState.mockReturnValue({
      activeStatuses: { c1: { type: "error" } },
    });
    const { result } = renderHook(() => useConnectionLifecycle());
    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.connect("c1");
    });
    expect(returned).toBe(false);
  });

  it("disconnect: delegates to the store lifecycle action", async () => {
    const { result } = renderHook(() => useConnectionLifecycle());
    await act(async () => {
      await result.current.disconnect("c1");
    });
    expect(mockDisconnect).toHaveBeenCalledWith("c1");
  });

  it("connect: backend가 reject하면 cache clear를 부르지 않는다", async () => {
    // Keeping the stale state is safe — a failed connect did not create a
    // backend pool, so there is no source to fetch fresh data from. The
    // existing cache should stay in front of the user.
    mockConnect.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useConnectionLifecycle());
    await act(async () => {
      await expect(result.current.connect("c1")).rejects.toThrow("boom");
    });
    expect(mockClearConnectionSchemaCache).not.toHaveBeenCalled();
    expect(mockClearDocumentCatalog).not.toHaveBeenCalled();
    expect(mockClearDocumentQuery).not.toHaveBeenCalled();
  });
});
