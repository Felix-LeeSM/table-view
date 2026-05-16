// 작성 2026-05-16 (Phase 2 sprint-360).
//
// 사유: state-management-strategy Q23 self-window schemaCache invalidate.
// DDL (`CREATE TABLE foo ...`) 가 그 window 의 sidebar 캐시를 100ms 안에
// 무효화하고 `loadSchemas(connId, db)` 를 다시 호출하도록 강제한다.
// Cross-window broadcast 는 sprint-365 의 책임 — 본 sliсe 는 same-window
// eager refetch 만 검증한다.
//
// AC 매핑:
//   AC-360-02: `runRdbSingleNow` 완료 후 `query_type === "ddl"` 이면
//              `schemaStore.clearForConnection(connId)` 호출.
//   AC-360-03: clear 직후 그 conn 의 sidebar 캐시가 비어 있어야 한다.
//   AC-360-04: completeQuery → clearForConnection 사이의 timing < 100ms.
//   AC-360-05: wide drop — `views`, `functions`, `triggers`,
//              `tableColumnsCache` 모두 비워진다 (narrow scope 금지).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSchemaCache } from "@hooks/useSchemaCache";
import { useQueryExecution } from "./QueryTab/useQueryExecution";
import { makeQueryTab, makeConn } from "./__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";
import type { SchemaInfo, TableInfo } from "@/types/schema";

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
const cancelQueryMock = vi.fn();
const listSchemasMock = vi.fn();
const listTablesMock = vi.fn();
const listViewsMock = vi.fn();
const listFunctionsMock = vi.fn();
const listSchemaColumnsMock = vi.fn();

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
  executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
  cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
  listSchemas: (...args: unknown[]) => listSchemasMock(...args),
  listTables: (...args: unknown[]) => listTablesMock(...args),
  listViews: (...args: unknown[]) => listViewsMock(...args),
  listFunctions: (...args: unknown[]) => listFunctionsMock(...args),
  listSchemaColumns: (...args: unknown[]) => listSchemaColumnsMock(...args),
  findDocuments: vi.fn(),
  aggregateDocuments: vi.fn(),
  findOneDocument: vi.fn(),
  countDocuments: vi.fn(),
  estimatedDocumentCount: vi.fn(),
  distinctDocuments: vi.fn(),
  insertDocument: vi.fn(),
  insertManyDocuments: vi.fn(),
  updateDocument: vi.fn(),
  updateMany: vi.fn(),
  deleteDocument: vi.fn(),
  deleteMany: vi.fn(),
  bulkWriteDocuments: vi.fn(),
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => {
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql,
  uglifySql: (sql: string) => sql,
}));

const DDL_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 0,
  execution_time_ms: 7,
  query_type: "ddl",
};

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", data_type: "integer", category: "unknown" }],
  rows: [[1]],
  total_count: 1,
  execution_time_ms: 4,
  query_type: "select",
};

// Seed the schema cache with non-trivial data across `views` / `functions`
// / `tableColumnsCache` / `triggers` so we can assert wide drop. Two
// different conn ids so we can assert other-conn caches survive.
function seedSchemaCache(): void {
  useSchemaStore.setState({
    schemas: {
      conn1: { db1: [{ name: "public" }] },
      "other-conn": { db1: [{ name: "public" }] },
    },
    tables: {
      conn1: {
        db1: {
          public: [{ name: "users", schema: "public", row_count: null }],
        },
      },
      "other-conn": {
        db1: {
          public: [{ name: "users", schema: "public", row_count: null }],
        },
      },
    },
    views: {
      conn1: {
        db1: {
          public: [{ name: "v1", schema: "public", definition: null }],
        },
      },
    },
    functions: {
      conn1: {
        db1: {
          public: [
            {
              name: "fn1",
              schema: "public",
              arguments: null,
              returnType: null,
              language: "sql",
              source: null,
              kind: "function",
            },
          ],
        },
      },
    },
    tableColumnsCache: {
      conn1: { db1: { public: { users: [] } } },
      "other-conn": { db1: { public: { users: [] } } },
    },
    triggers: {
      conn1: {
        db1: {
          public: {
            users: [
              {
                name: "trg",
                schema: "public",
                table: "users",
                timing: "BEFORE",
                events: ["INSERT"],
                orientation: "ROW",
                functionSchema: "audit",
                functionName: "log",
                arguments: null,
                whenExpression: null,
                definition: "",
              },
            ],
          },
        },
      },
    },
    loading: false,
    error: null,
  });
}

function seedTab(sql: string) {
  // Use DROP TABLE syntax — `severity: "danger"`, non-prod + `warn` mode
  // → `decideSafeModeAction` returns `allow` and `hasWarn` stays false.
  // This routes directly to `runRdbSingleNow` without mounting a
  // pendingRdbWarn / pendingRdbConfirm dialog, isolating the self-
  // invalidate assertion from SafeMode dialog mechanics.
  const tab = makeQueryTab({ sql, database: "db1" });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [makeConn({ id: "conn1", environment: "development" })],
  });
  return tab;
}

describe("useQueryExecution — sprint-360 Phase 2 Q23 self-invalidate", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    listSchemasMock.mockReset();
    listTablesMock.mockReset();
    listViewsMock.mockReset();
    listFunctionsMock.mockReset();
    listSchemaColumnsMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    useQueryHistoryStore.setState({ recentVisible: [] });
    // `warn` mode keeps the SafeMode gate at `allow` for `severity: danger`
    // statements on non-production (DROP TABLE goes direct to runRdbSingleNow).
    useSafeModeStore.setState({ mode: "warn" });
    useSchemaStore.setState({
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      tableColumnsCache: {},
      triggers: {},
      loading: false,
      error: null,
    });
  });

  // AC-360-02 — DDL 결과 (`query_type === "ddl"`) 가 도착하면 hook 이
  // `schemaStore.clearForConnection(connId)` 를 호출. drop / create 둘 다
  // 백엔드가 `query_type: "ddl"` 로 분류한다.
  it("AC-360-02: clears schemaStore for the connection after a DDL result", async () => {
    executeQueryMock.mockResolvedValueOnce(DDL_RESULT);
    seedSchemaCache();
    const tab = seedTab("DROP TABLE foo");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeQueryMock).toHaveBeenCalledTimes(1);
    });

    // AC-360-02 + AC-360-03: byConnection[conn1] is empty.
    await waitFor(() => {
      const state = useSchemaStore.getState();
      expect(state.schemas.conn1).toBeUndefined();
      expect(state.tables.conn1).toBeUndefined();
    });
  });

  // AC-360-05 — wide drop. views / functions / triggers /
  // tableColumnsCache 도 함께 비워진다. 다른 conn 의 캐시는 손대지 않는다.
  it("AC-360-05: wide drop — views/functions/triggers/columns cleared, other conn preserved", async () => {
    executeQueryMock.mockResolvedValueOnce(DDL_RESULT);
    seedSchemaCache();
    const tab = seedTab("DROP TABLE foo");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      const state = useSchemaStore.getState();
      // wide drop on conn1
      expect(state.schemas.conn1).toBeUndefined();
      expect(state.tables.conn1).toBeUndefined();
      expect(state.views.conn1).toBeUndefined();
      expect(state.functions.conn1).toBeUndefined();
      expect(state.tableColumnsCache.conn1).toBeUndefined();
      expect(state.triggers.conn1).toBeUndefined();
      // other-conn cache preserved across slots
      expect(state.schemas["other-conn"]?.db1).toHaveLength(1);
      expect(state.tables["other-conn"]?.db1?.public).toHaveLength(1);
      expect(state.tableColumnsCache["other-conn"]?.db1?.public?.users).toEqual(
        [],
      );
    });
  });

  // AC-360-04 — IPC 응답(`executeQuery` resolves) ~ DOM-equivalent cache
  // update (`schemaStore.clearForConnection`) 까지 < 100ms. clear 자체는
  // 동기 setState 이므로 IPC resolves 직후 한 microtask 안에 끝난다.
  // performance.now() 로 측정해 envelope 안에 들어오는지 확인.
  it("AC-360-04: DDL response → schemaStore cache wipe < 100ms", async () => {
    seedSchemaCache();
    let resolveExec: ((value: QueryResult) => void) | null = null;
    executeQueryMock.mockImplementationOnce(
      () =>
        new Promise<QueryResult>((resolve) => {
          resolveExec = resolve;
        }),
    );
    // DROP TABLE keeps SafeMode gate at `allow` for non-prod+warn (severity
    // danger but action allow). CREATE TABLE is `severity: "warn"` which
    // routes to pendingRdbWarn instead of runRdbSingleNow direct — that
    // path is covered by the WARN-tier confirm tests in sprint-255.
    const tab = seedTab("DROP TABLE foo");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    // Kick off handleExecute; resolves only when we call `resolveExec`.
    let executePromise: Promise<void> = Promise.resolve();
    act(() => {
      executePromise = result.current.handleExecute();
    });

    // Wait for the IPC mock to be invoked so the hook is awaiting it.
    await waitFor(() => {
      expect(executeQueryMock).toHaveBeenCalledTimes(1);
    });

    // Mark IPC response time and let the hook finish.
    const start = performance.now();
    await act(async () => {
      resolveExec!(DDL_RESULT);
      await executePromise;
    });
    const elapsed = performance.now() - start;

    // The clear is a synchronous setState driven by the awaited IPC
    // resolve; the elapsed window covers IPC return → React commit.
    expect(elapsed).toBeLessThan(100);
    const state = useSchemaStore.getState();
    expect(state.schemas.conn1).toBeUndefined();
  });

  // AC-360-03 — Sidebar (`useSchemaCache`) auto-refetches when the cache
  // for its `(connId, db)` slot is cleared while it is mounted. The
  // refetch fires within one microtask of the IPC resolve so the new
  // table ("foo") appears in the schema list under the 100ms envelope.
  // We use DROP TABLE here so the SafeMode gate routes directly to
  // runRdbSingleNow (CREATE TABLE would mount the WARN dialog — that
  // path is exercised in the warn-tier confirm tests).
  it("AC-360-03: mounted useSchemaCache refetches schemas after DDL invalidate", async () => {
    // First listSchemas call (mount) returns the original schema; the
    // second call (post-DDL invalidate) returns the new schema list that
    // includes the freshly created table via loadTables.
    listSchemasMock
      .mockResolvedValueOnce([{ name: "public" }] satisfies SchemaInfo[])
      .mockResolvedValueOnce([{ name: "public" }] satisfies SchemaInfo[]);
    listTablesMock
      .mockResolvedValueOnce([
        { name: "users", schema: "public", row_count: null },
      ] satisfies TableInfo[])
      .mockResolvedValueOnce([
        { name: "foo", schema: "public", row_count: null },
      ] satisfies TableInfo[]);
    listSchemaColumnsMock.mockResolvedValue({});
    executeQueryMock.mockResolvedValueOnce(DDL_RESULT);

    const tab = seedTab("DROP TABLE users");

    // Mount useSchemaCache first so the auto-load fires for ("conn1", "db1").
    const cacheHook = renderHook(() => useSchemaCache(tab.connectionId, "db1"));
    await waitFor(() => {
      expect(listSchemasMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      const state = useSchemaStore.getState();
      expect(state.tables.conn1?.db1?.public).toHaveLength(1);
    });

    // Now fire the DDL execution. The hook's clearForConnection wipes the
    // cache and the useSchemaCache effect re-runs (slot is undefined) and
    // re-fetches.
    const execHook = renderHook(() => useQueryExecution({ tab }));
    await act(async () => {
      await execHook.result.current.handleExecute();
    });

    await waitFor(() => {
      // Second mount-effect run: schemas + tables refetched.
      expect(listSchemasMock).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      const tables = useSchemaStore.getState().tables.conn1?.db1?.public;
      // After refetch, the new table list reflects the post-DDL state
      // (the mock returns `[foo]` on the second loadTables call).
      expect(tables?.some((t) => t.name === "foo")).toBe(true);
    });

    // Cleanup
    cacheHook.unmount();
    execHook.unmount();
  });

  // Test Requirement (d) — Sidebar unmount 시 refetch skip. Once
  // useSchemaCache unmounts, the wipe must NOT trigger a fresh
  // listSchemas IPC call. Without this guarantee the autoLoadedRef
  // would keep firing IPCs for invisible sidebars.
  it("AC-360-03 (d): refetch is skipped after sidebar unmounts", async () => {
    listSchemasMock.mockResolvedValue([{ name: "public" }]);
    listTablesMock.mockResolvedValue([]);
    listSchemaColumnsMock.mockResolvedValue({});
    executeQueryMock.mockResolvedValueOnce(DDL_RESULT);

    const tab = seedTab("DROP TABLE foo");

    // Mount + unmount before the DDL fires.
    const cacheHook = renderHook(() => useSchemaCache(tab.connectionId, "db1"));
    await waitFor(() => {
      expect(listSchemasMock).toHaveBeenCalledTimes(1);
    });
    cacheHook.unmount();
    listSchemasMock.mockClear();

    // Now fire DDL — the cache wipe still runs but no listSchemas IPC
    // because nothing is mounted.
    const execHook = renderHook(() => useQueryExecution({ tab }));
    await act(async () => {
      await execHook.result.current.handleExecute();
    });

    // schemaStore is cleared
    expect(useSchemaStore.getState().schemas.conn1).toBeUndefined();
    // But no fresh IPC fired because nothing was listening.
    expect(listSchemasMock).not.toHaveBeenCalled();
    execHook.unmount();
  });

  // Guard — non-DDL results (SELECT) must NOT trigger clearForConnection.
  // Without this, every SELECT would dump the schema cache and the
  // sidebar would refetch for every row read.
  it("does not clear the cache for non-DDL results", async () => {
    executeQueryMock.mockResolvedValueOnce(SELECT_RESULT);
    seedSchemaCache();
    const tab = seedTab("SELECT * FROM foo");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeQueryMock).toHaveBeenCalledTimes(1);
    });

    // cache untouched on SELECT
    const state = useSchemaStore.getState();
    expect(state.schemas.conn1?.db1).toHaveLength(1);
    expect(state.tables.conn1?.db1?.public).toHaveLength(1);
  });
});
