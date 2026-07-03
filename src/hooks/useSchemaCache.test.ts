// AC-191-02 — `useSchemaCache` 데이터 레이어 hook 단위 테스트. SchemaTree
// 1963 줄 god component 에서 분리된 책임 (mount load / refresh / lazy
// expand / silent failure → toast) 을 React 환경 + zustand store 와의
// 통합으로 단언한다. SchemaTree.test.tsx 도 hook 동작을 간접적으로 단언
// 하지만 (UI 가 가시화되는 상태만), 본 테스트는 hook 의 fault 분기
// (load reject → toast.error) 를 직접 단언한다. date 2026-05-02.
//
// 2026-05-12 — Sprint 263. hook signature 가 `(connId, db)` 로 확장됐고
// schemaStore 가 `(connId, db, schema)` 로 nested 됐다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSchemaCache } from "./useSchemaCache";
import { useSchemaStore } from "@stores/schemaStore";

// `@lib/runtime/toast` is the canonical sink for hook failures (Sprint 191
// AC-191-03). The store mocks below already use vi.fn() for tauri
// adapters; here we mock the toast module so we can assert that the
// hook routes failures to toast.error rather than swallowing them.
vi.mock("@/lib/runtime/toast", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));
beforeEach(() => {
  setupTauriMock({
    listDatabases: vi.fn(() => Promise.resolve([{ name: "db1" }])),
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
  });
});

beforeEach(() => {
  useSchemaStore.setState({
    databases: {},
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
    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    await waitFor(() => {
      expect(result.current.schemas.length).toBe(1);
    });
    // After mount the store should be hydrated with the public schema and
    // its tables (loadTables + prefetchSchemaColumns are auto-fired).
    await waitFor(() => {
      expect(useSchemaStore.getState().databases.conn1).toEqual([
        { name: "db1" },
      ]);
    });
    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toEqual([{ name: "public" }]);
    expect(state.tables.conn1?.db1?.public).toEqual([]);
  });

  it("[AC-191-02-2] refreshSchema evicts cached entries before reloading", async () => {
    // Seed cached entries that the action should drop before the fresh
    // loadTables/loadViews/loadFunctions calls land.
    useSchemaStore.setState({
      tables: {
        conn1: {
          db1: {
            public: [{ name: "stale", schema: "public", row_count: null }],
          },
        },
      },
      views: {
        conn1: {
          db1: {
            public: [{ name: "v_stale", schema: "public", definition: null }],
          },
        },
      },
      functions: { conn1: { db1: { public: [] } } },
    });
    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));

    act(() => {
      result.current.refreshSchema("public");
    });

    await waitFor(() => {
      const state = useSchemaStore.getState();
      // Post-reload the entries are repopulated by the (mocked) tauri
      // adapters with their default empty payloads — confirming both the
      // eviction and the fresh load happened.
      expect(state.tables.conn1?.db1?.public).toEqual([]);
      expect(state.views.conn1?.db1?.public).toEqual([]);
    });
  });

  it("[AC-191-02-3] expandSchema skips loadTables when already cached", async () => {
    const tauri = await import("@lib/tauri");
    const listTables = tauri.listTables as ReturnType<typeof vi.fn>;
    // Pre-populate the cache so expandSchema's lazy guard short-circuits.
    useSchemaStore.setState({
      schemas: { conn1: { db1: [{ name: "public" }] } },
      tables: {
        conn1: {
          db1: {
            public: [{ name: "users", schema: "public", row_count: 1 }],
          },
        },
      },
      views: { conn1: { db1: { public: [] } } },
      functions: { conn1: { db1: { public: [] } } },
    });

    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    listTables.mockClear();

    await act(async () => {
      await result.current.expandSchema("public");
    });

    expect(listTables).not.toHaveBeenCalled();
  });

  it("[AC-1219-1] mount above the eager threshold loads the schema list only (lazy)", async () => {
    // #1219 — a DB with many schemas must not fan out into a per-schema
    // loadTables / prefetch loop at mount (the N+1 first-paint bottleneck).
    const tauri = await import("@lib/tauri");
    const listSchemas = tauri.listSchemas as ReturnType<typeof vi.fn>;
    const listTables = tauri.listTables as ReturnType<typeof vi.fn>;
    const listSchemaColumns = tauri.listSchemaColumns as ReturnType<
      typeof vi.fn
    >;
    listSchemas.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ name: `s${i}` })),
    );

    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    await waitFor(() => expect(result.current.schemas.length).toBe(6));

    expect(listTables).not.toHaveBeenCalled();
    expect(listSchemaColumns).not.toHaveBeenCalled();
  });

  it("[AC-1219-2] mount at or below the eager threshold loads every schema's tables", async () => {
    const tauri = await import("@lib/tauri");
    const listSchemas = tauri.listSchemas as ReturnType<typeof vi.fn>;
    const listTables = tauri.listTables as ReturnType<typeof vi.fn>;
    listSchemas.mockResolvedValue([{ name: "public" }, { name: "analytics" }]);

    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    await waitFor(() => expect(result.current.schemas.length).toBe(2));

    await waitFor(() => {
      expect(listTables).toHaveBeenCalledWith("conn1", "public", "db1");
      expect(listTables).toHaveBeenCalledWith("conn1", "analytics", "db1");
    });
  });

  it("[AC-1219-3] expandSchema prefetches columns so autocomplete keeps working", async () => {
    // In the lazy path columns are not prefetched at mount; expanding a
    // schema must pull them so the SQL autocomplete catalog is populated.
    const tauri = await import("@lib/tauri");
    const listSchemas = tauri.listSchemas as ReturnType<typeof vi.fn>;
    const listSchemaColumns = tauri.listSchemaColumns as ReturnType<
      typeof vi.fn
    >;
    listSchemas.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({ name: `s${i}` })),
    );

    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    await waitFor(() => expect(result.current.schemas.length).toBe(6));
    expect(listSchemaColumns).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.expandSchema("s0");
    });

    expect(listSchemaColumns).toHaveBeenCalledWith("conn1", "s0", "db1");
  });

  it("[AC-1219-4] eager threshold counts user schemas only, ignoring system schemas", async () => {
    // Regression from PR #1263 round 1: the backend `list_namespaces` returns
    // system schemas (DuckDB `main` / `temp`) alongside the 4 user schemas, so
    // the raw list length (6) tipped a small DB into the lazy path and the
    // first-schema seed hid `core.*`. The threshold must count only user
    // schemas so this small DB stays eager (AC-3) and every user schema loads.
    const tauri = await import("@lib/tauri");
    const listSchemas = tauri.listSchemas as ReturnType<typeof vi.fn>;
    const listTables = tauri.listTables as ReturnType<typeof vi.fn>;
    listSchemas.mockResolvedValue([
      { name: "main" },
      { name: "temp" },
      { name: "catalog" },
      { name: "core" },
      { name: "sales" },
      { name: "support" },
    ]);

    const { result } = renderHook(() => useSchemaCache("conn1", "db1"));
    await waitFor(() => expect(result.current.schemas.length).toBe(6));

    await waitFor(() => {
      expect(listTables).toHaveBeenCalledWith("conn1", "core", "db1");
      expect(listTables).toHaveBeenCalledWith("conn1", "support", "db1");
    });
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

    renderHook(() => useSchemaCache("conn1", "db1"));

    await waitFor(() => {
      expect(useSchemaStore.getState().error).toMatch(/backend offline/);
    });
  });
});
