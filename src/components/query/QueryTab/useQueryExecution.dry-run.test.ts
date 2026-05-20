// Sprint 248 (ADR 0022 Phase 4) — `useQueryExecution.handleDryRun`
// contract. The hook owns the explicit "Dry Run" dispatch path the
// new toolbar button + Cmd+Shift+Enter shortcut both call into; this
// test pins the 7 acceptance criteria from `docs/sprints/sprint-248/contract.md`
// (`AC-248-E1..E7`). date 2026-05-09.
//
// We exercise the hook via `renderHook` rather than mounting QueryTab
// because:
//   1. The hook's contract (paradigm gate, running/empty guards,
//      queryId prefix, IPC dispatch, success → completeQueryDryRun,
//      failure → failQuery) is independent of the Toolbar / editor
//      wiring tested in `QueryTab.toolbar.test.tsx`.
//   2. Routing through the rendered component would require keeping
//      every other QueryTab dependency (favorites store, MRU,
//      autocomplete, paradigm router) in sync — a high-cost mock
//      surface for a hook contract.
//
// Mock surface mirrors `useQueryExecution.ts` imports: tauri IPC
// (executeQueryDryRun + cancelQuery + executeQuery + find/aggregate),
// `@lib/sql/sqlUtils.splitSqlStatements`, `@lib/toast.toast.info`, and
// `useSafeModeGate` (no-op since dry-run never invokes the gate).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useToastStore } from "@lib/toast";
import { useQueryExecution } from "./useQueryExecution";
import { makeQueryTab, makeDocTab } from "../__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";

const executeQueryDryRunMock = vi.fn();
const executeQueryMock = vi.fn();
const cancelQueryMock = vi.fn();
const findDocumentsMock = vi.fn();
const aggregateDocumentsMock = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => executeQueryMock(...args),
    executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
    cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
    findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
    aggregateDocuments: (...args: unknown[]) => aggregateDocumentsMock(...args),
  });
});

// `dispatchDbMutationHint` calls verifyActiveDb fire-and-forget. Stub
// so the dry-run tests don't accidentally trigger the real IPC.
//
// Sprint 271b — the dry-run mismatch case below relies on the same
// `verifyActiveDb` mock to drive `syncMismatchedActiveDb`. We expose a
// hoisted vi.fn so individual tests can change its resolved value.
const verifyActiveDbMock = vi.hoisted(() => vi.fn().mockResolvedValue(""));
vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

// Sprint 248 — `splitSqlStatements` keeps semicolon-separated parts so
// the dry-run multi-statement test can assert IPC payload === full
// array. Mirrors the simple split used by other QueryTab axis tests.
vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => {
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

const SELECT_RESULT: QueryResult = {
  columns: [{ name: "id", dataType: "integer", category: "unknown" }],
  rows: [[1]],
  totalCount: 1,
  executionTimeMs: 3,
  queryType: "select",
};

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  totalCount: 0,
  executionTimeMs: 5,
  queryType: { dml: { rows_affected: 4 } },
};

function seedTab(overrides: Parameters<typeof makeQueryTab>[0] = {}) {
  const tab = makeQueryTab(overrides);
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  return tab;
}

function seedDocTab(overrides: Parameters<typeof makeDocTab>[0] = {}) {
  const tab = makeDocTab(overrides);
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  return tab;
}

describe("useQueryExecution — handleDryRun (Sprint 248)", () => {
  beforeEach(() => {
    executeQueryDryRunMock.mockReset();
    executeQueryMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useQueryHistoryStore.setState({ recentVisible: [] });
    useToastStore.setState({ toasts: [] });
  });

  // [AC-248-E1] document paradigm → toast.info, IPC NOT called.
  it("[AC-248-E1] document paradigm → toast.info disclaimer + IPC not called", async () => {
    const tab = seedDocTab({ sql: "{}" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.variant).toBe("info");
    expect(toasts[0]!.message).toBe("Dry-run is not supported for MongoDB.");
    // History stays empty — dry-runs never record history.
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });

  // [AC-248-E2] running tab → no-op, IPC NOT called.
  it("[AC-248-E2] running queryState → no-op, IPC not called", async () => {
    const tab = seedTab({
      sql: "SELECT 1",
      queryState: { status: "running", queryId: "q-existing-1" },
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    // QueryState left untouched (no transition out of running).
    const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id);
    expect(
      updated && updated.type === "query" && updated.queryState.status,
    ).toBe("running");
  });

  // [AC-248-E3] empty SQL → no-op, IPC NOT called.
  it("[AC-248-E3] empty SQL → no-op, IPC not called", async () => {
    const tab = seedTab({ sql: "   " });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });

  // [AC-248-E4] rdb + single statement + IPC success →
  // `completeQueryDryRun` payload with `isDryRun: true`.
  it("[AC-248-E4] rdb single-statement success → completeQueryDryRun w/ isDryRun=true", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([DML_RESULT]);
    const tab = seedTab({ sql: "DELETE FROM users WHERE id = 1" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    // Sprint 271b — workspaceDb is forwarded as the 4th positional
    // `expectedDatabase`. `seedWorkspace` aligns the connection store
    // with the seeded tab; without an explicit `database` the default
    // workspace db is `DEFAULT_TEST_DB === "db1"`.
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["DELETE FROM users WHERE id = 1"],
      expect.stringMatching(/^dry:/),
      "db1",
    );

    await waitFor(() => {
      const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab missing");
      }
      expect(updated.queryState.status).toBe("completed");
    });
    const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id)!;
    if (updated.type !== "query") throw new Error("not query");
    if (updated.queryState.status !== "completed") {
      throw new Error("not completed");
    }
    expect(updated.queryState.isDryRun).toBe(true);
    expect(updated.queryState.result).toEqual(DML_RESULT);
    expect(updated.queryState.statements).toBeUndefined();
    // History MUST stay empty — dry-runs are ephemeral.
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
    // Real-execute IPC never fired.
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  // [AC-248-E5] rdb + IPC reject → `failQuery` (status=error).
  it("[AC-248-E5] rdb single-statement IPC reject → failQuery", async () => {
    executeQueryDryRunMock.mockRejectedValueOnce(
      new Error("statement 1 of 1 failed: syntax error"),
    );
    const tab = seedTab({ sql: "DROP TABLE foo" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    await waitFor(() => {
      const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") throw new Error("missing");
      expect(updated.queryState.status).toBe("error");
    });
    const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id)!;
    if (updated.type !== "query" || updated.queryState.status !== "error") {
      throw new Error("not error");
    }
    expect(updated.queryState.error).toContain(
      "statement 1 of 1 failed: syntax error",
    );
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });

  // [AC-248-E6] rdb + multi-statement → IPC called once with full
  // statements array; payload populates `statements` breakdown +
  // `isDryRun: true`.
  it("[AC-248-E6] rdb multi-statement → single IPC call + statements breakdown + isDryRun", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([SELECT_RESULT, DML_RESULT]);
    const tab = seedTab({
      sql: "SELECT * FROM users; DELETE FROM users WHERE id = 1",
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    // Sprint 271b — workspaceDb is forwarded as the 4th positional
    // `expectedDatabase`. `seedWorkspace` defaults to `DEFAULT_TEST_DB`.
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["SELECT * FROM users", "DELETE FROM users WHERE id = 1"],
      expect.stringMatching(/^dry:/),
      "db1",
    );

    await waitFor(() => {
      const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") throw new Error("missing");
      expect(updated.queryState.status).toBe("completed");
    });
    const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id)!;
    if (updated.type !== "query" || updated.queryState.status !== "completed") {
      throw new Error("not completed");
    }
    expect(updated.queryState.isDryRun).toBe(true);
    expect(updated.queryState.statements).toBeDefined();
    expect(updated.queryState.statements).toHaveLength(2);
    expect(updated.queryState.statements![0]!.status).toBe("success");
    expect(updated.queryState.statements![0]!.sql).toBe("SELECT * FROM users");
    expect(updated.queryState.statements![1]!.status).toBe("success");
    expect(updated.queryState.statements![1]!.sql).toBe(
      "DELETE FROM users WHERE id = 1",
    );
    // last result mirrors statements[last]
    expect(updated.queryState.result).toEqual(DML_RESULT);
    expect(useQueryHistoryStore.getState().recentVisible).toHaveLength(0);
  });

  // [AC-248-E7] queryId 가 `"dry:"` 로 시작.
  it('[AC-248-E7] queryId is prefixed with "dry:"', async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([DML_RESULT]);
    const tab = seedTab({ sql: "UPDATE t SET x = 1" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    const call = executeQueryDryRunMock.mock.calls[0]!;
    expect(call[2]).toEqual(expect.stringMatching(/^dry:/));
  });

  // Sprint 271b (2026-05-13) — workspaceDb forwarding.
  //
  // 작성 이유: dry-run preview MUST run on the same db the eventual
  // commit will hit. The contract pins useQueryExecution's dry-run path
  // to thread the workspace `(connId, db)` like it already does for the
  // executeQuery / executeQueryBatch paths. Without this guard a
  // swapped pool could roll back against a different db than the user
  // intended to preview.
  it("forwards tab.database as expectedDatabase (4th positional)", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([DML_RESULT]);
    const tab = seedTab({
      sql: "UPDATE t SET x = 1",
      database: "myDb",
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["UPDATE t SET x = 1"],
      expect.stringMatching(/^dry:/),
      "myDb",
    );
  });

  // Sprint 271b (2026-05-13) — DbMismatch end-to-end.
  //
  // 작성 이유: mocked IPC throws Sprint 266 wire format → useQueryExecution
  // 의 catch 가 parseDbMismatch 로 감지 → syncMismatchedActiveDb 가
  // verifyActiveDb 의 새 db 를 받아 toast.warning 발사 (user-initiated
  // dry-run 은 Sprint 269 Retry toast 재사용; background introspection 만
  // silent).
  it("routes DbMismatch through syncMismatchedActiveDb + Retry toast", async () => {
    executeQueryDryRunMock.mockRejectedValueOnce(
      new Error(
        "Database mismatch: expected 'db1', backend pool has 'otherDb'",
      ),
    );
    verifyActiveDbMock.mockResolvedValueOnce("otherDb");
    // Omit `database` so the tab lives in the default workspace slot
    // (`conn1` / `db1`) — `getTestWorkspace()` reads that slot.
    const tab = seedTab({ sql: "UPDATE t SET x = 1" });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleDryRun();
    });

    // failQuery surfaces the mismatch as an error.
    await waitFor(() => {
      const updated = getTestWorkspace().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") throw new Error("missing");
      expect(updated.queryState.status).toBe("error");
    });

    // sync helper fired against the workspace conn id.
    await waitFor(() => {
      expect(verifyActiveDbMock).toHaveBeenCalledWith("conn1");
    });

    // user-initiated → Retry toast surfaces.
    await waitFor(() => {
      const toasts = useToastStore.getState().toasts;
      expect(toasts.some((t) => t.variant === "warning")).toBe(true);
    });
  });
});
