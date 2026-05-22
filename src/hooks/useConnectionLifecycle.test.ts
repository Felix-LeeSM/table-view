import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// 2026-05-05 — AC-148-4 retire sprint. connect/disconnect 시 schema/document
// cache가 함께 invalidate되어야 재진입 화면에서 stale schema가 "초기 DB"로
// 잘못 노출되지 않는다 (plan: connections-window-connection-nifty-meerkat.md).
// Hook은 store action 호출 직후 같은 connectionId로 두 cache clear를 부른다.

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
    // 2026-05-05 — connectionStore.connectToDatabase는 throw 대신 status를
    // error 변형에 기록한다. 호출자가 await만으로는 성공 여부를 알 수 없어
    // hook이 fresh status를 읽어 boolean으로 환산한다.
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
    // stale state 보존이 안전 — 실패한 connect는 backend pool도 안 만들었으므로
    // 새로 fetch할 source 자체가 없다. 기존 cache가 사용자에게 남는 게 옳다.
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
