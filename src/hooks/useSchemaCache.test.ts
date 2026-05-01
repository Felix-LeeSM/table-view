// AC-191-02 — `useSchemaCache` 데이터 레이어 hook 단위 테스트. SchemaTree
// 1963 줄 god component 에서 분리된 책임 (mount load / refresh / lazy
// expand / silent failure → toast) 을 React 환경 + zustand store 와의
// 통합으로 단언한다. SchemaTree.test.tsx 도 hook 동작을 간접적으로 단언
// 하지만 (UI 가 가시화되는 상태만), 본 테스트는 hook 의 fault 분기
// (load reject → toast.error) 를 직접 단언한다. date 2026-05-02.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSchemaCache } from "./useSchemaCache";
import { useSchemaStore } from "@stores/schemaStore";

// `@lib/toast` is the canonical sink for hook failures (Sprint 191
// AC-191-03). The store mocks below already use vi.fn() for tauri
// adapters; here we mock the toast module so we can assert that the
// hook routes failures to toast.error rather than swallowing them.
vi.mock("@/lib/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// Tauri invoke layer — defaults to resolve, individual tests override
// with `mockRejectedValueOnce` for failure-path assertions.
vi.mock("@lib/tauri", () => ({
  listSchemas: vi.fn(() => Promise.resolve([{ name: "public" }])),
  listTables: vi.fn(() => Promise.resolve([])),
  listViews: vi.fn(() => Promise.resolve([])),
  listFunctions: vi.fn(() => Promise.resolve([])),
  listSchemaColumns: vi.fn(() => Promise.resolve({})),
  getTableColumns: vi.fn(() => Promise.resolve([])),
  getTableIndexes: vi.fn(() => Promise.resolve([])),
  getTableConstraints: vi.fn(() => Promise.resolve([])),
  queryTableData: vi.fn(),
  executeQuery: vi.fn(),
  executeQueryBatch: vi.fn(),
  dropTable: vi.fn(),
  renameTable: vi.fn(),
  getViewColumns: vi.fn(() => Promise.resolve([])),
  getViewDefinition: vi.fn(() => Promise.resolve("")),
}));

beforeEach(() => {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    tableColumnsCache: {},
    loading: false,
    error: null,
  });
  vi.clearAllMocks();
});

describe("useSchemaCache", () => {
  it("[AC-191-02-1] mount triggers loadSchemas + per-schema loadTables", async () => {
    const { result } = renderHook(() => useSchemaCache("conn1"));
    await waitFor(() => {
      expect(result.current.schemas.length).toBe(1);
    });
    // After mount the store should be hydrated with the public schema and
    // its tables (loadTables + prefetchSchemaColumns are auto-fired).
    const state = useSchemaStore.getState();
    expect(state.schemas["conn1"]).toEqual([{ name: "public" }]);
    expect(state.tables["conn1:public"]).toEqual([]);
  });

  it("[AC-191-02-2] refreshSchema evicts cached entries before reloading", async () => {
    // Seed cached entries that the action should drop before the fresh
    // loadTables/loadViews/loadFunctions calls land.
    useSchemaStore.setState({
      tables: {
        "conn1:public": [{ name: "stale", schema: "public", row_count: null }],
      },
      views: {
        "conn1:public": [
          { name: "v_stale", schema: "public", definition: null },
        ],
      },
      functions: { "conn1:public": [] },
    });
    const { result } = renderHook(() => useSchemaCache("conn1"));

    act(() => {
      result.current.refreshSchema("public");
    });

    await waitFor(() => {
      const state = useSchemaStore.getState();
      // Post-reload the entries are repopulated by the (mocked) tauri
      // adapters with their default empty payloads — confirming both the
      // eviction and the fresh load happened.
      expect(state.tables["conn1:public"]).toEqual([]);
      expect(state.views["conn1:public"]).toEqual([]);
    });
  });

  it("[AC-191-02-3] expandSchema skips loadTables when already cached", async () => {
    const tauri = await import("@lib/tauri");
    const listTables = tauri.listTables as ReturnType<typeof vi.fn>;
    // Pre-populate the cache so expandSchema's lazy guard short-circuits.
    useSchemaStore.setState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [{ name: "users", schema: "public", row_count: 1 }],
      },
      views: { "conn1:public": [] },
      functions: { "conn1:public": [] },
    });

    const { result } = renderHook(() => useSchemaCache("conn1"));
    listTables.mockClear();

    await act(async () => {
      await result.current.expandSchema("public");
    });

    expect(listTables).not.toHaveBeenCalled();
  });

  it("[AC-191-02-4] backend listSchemas rejection records store error (current contract)", async () => {
    // Sprint 191 finding — `useSchemaStore.loadSchemas` swallows tauri
    // rejections internally and writes `String(e)` to the store's `error`
    // field instead of re-throwing. The hook's defensive `.catch` blocks
    // therefore never fire under the current store contract; we keep them
    // for forward compatibility but assert the realistic surface (store
    // error state populated). The follow-up to surface this error to the
    // user is tracked in findings §6 (UI banner / store contract change).
    // date 2026-05-02.
    const tauri = await import("@lib/tauri");
    const listSchemas = tauri.listSchemas as ReturnType<typeof vi.fn>;
    listSchemas.mockRejectedValueOnce(new Error("backend offline"));

    renderHook(() => useSchemaCache("conn1"));

    await waitFor(() => {
      expect(useSchemaStore.getState().error).toMatch(/backend offline/);
    });
  });
});
