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
import { act, renderHook, waitFor } from "@testing-library/react";
import { useTabStore } from "@stores/tabStore";
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

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
  executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
  cancelQuery: (...args: unknown[]) => cancelQueryMock(...args),
  findDocuments: (...args: unknown[]) => findDocumentsMock(...args),
  aggregateDocuments: (...args: unknown[]) => aggregateDocumentsMock(...args),
}));

// `dispatchDbMutationHint` calls verifyActiveDb fire-and-forget. Stub
// so the dry-run tests don't accidentally trigger the real IPC.
vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
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
  columns: [{ name: "id", data_type: "integer", category: "unknown" }],
  rows: [[1]],
  total_count: 1,
  execution_time_ms: 3,
  query_type: "select",
};

const DML_RESULT: QueryResult = {
  columns: [],
  rows: [],
  total_count: 0,
  execution_time_ms: 5,
  query_type: { dml: { rows_affected: 4 } },
};

function seedTab(overrides: Parameters<typeof makeQueryTab>[0] = {}) {
  const tab = makeQueryTab(overrides);
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
  return tab;
}

function seedDocTab(overrides: Parameters<typeof makeDocTab>[0] = {}) {
  const tab = makeDocTab(overrides);
  useTabStore.setState({ tabs: [tab], activeTabId: tab.id });
  return tab;
}

describe("useQueryExecution — handleDryRun (Sprint 248)", () => {
  beforeEach(() => {
    executeQueryDryRunMock.mockReset();
    executeQueryMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
    useTabStore.setState({ tabs: [], activeTabId: null });
    useQueryHistoryStore.setState({ entries: [] });
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
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
    const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id);
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
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["DELETE FROM users WHERE id = 1"],
      expect.stringMatching(/^dry:/),
    );

    await waitFor(() => {
      const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") {
        throw new Error("tab missing");
      }
      expect(updated.queryState.status).toBe("completed");
    });
    const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id)!;
    if (updated.type !== "query") throw new Error("not query");
    if (updated.queryState.status !== "completed") {
      throw new Error("not completed");
    }
    expect(updated.queryState.isDryRun).toBe(true);
    expect(updated.queryState.result).toEqual(DML_RESULT);
    expect(updated.queryState.statements).toBeUndefined();
    // History MUST stay empty — dry-runs are ephemeral.
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
      const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") throw new Error("missing");
      expect(updated.queryState.status).toBe("error");
    });
    const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id)!;
    if (updated.type !== "query" || updated.queryState.status !== "error") {
      throw new Error("not error");
    }
    expect(updated.queryState.error).toContain(
      "statement 1 of 1 failed: syntax error",
    );
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["SELECT * FROM users", "DELETE FROM users WHERE id = 1"],
      expect.stringMatching(/^dry:/),
    );

    await waitFor(() => {
      const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id);
      if (!updated || updated.type !== "query") throw new Error("missing");
      expect(updated.queryState.status).toBe("completed");
    });
    const updated = useTabStore.getState().tabs.find((t) => t.id === tab.id)!;
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
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
});
