// Sprint 254 (2026-05-09) — `useQueryExecution.handleExecute` 의 dry-run
// row-count escalation 검증. ADR 0023 grill Q2-(a) 의 핵심 보호: WARN-tier
// bounded UPDATE/DELETE 가 dry-run 결과 100+ row 면 STOP (`pendingRdbConfirm`)
// 으로 자동 escalate.
//
// 시나리오 (TDD red-fail 우선 작성):
//   - dry-run 100+ row → STOP escalate (pendingRdbConfirm mount).
//   - dry-run < 100 row → WARN preserved (pendingRdbWarn mount).
//   - dry-run timeout (2s) → STOP fallback.
//   - dry-run IPC unsupported / throws → STOP fallback.
//   - INSERT (INFO) → 직접 IPC, escalation skip.
//   - INFO statement (SELECT) → 직접 IPC, escalation skip.
//   - DANGER statement (DROP) → STOP confirm 그대로, escalation 분기 도달 X.
//
// `useQueryExecution` 직접 mount (renderHook) 가 가능한지는 다른 dry-run.test.ts
// 의 패턴 (full QueryTab mount 회피) 을 따른다.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryExecution } from "./useQueryExecution";
import { makeQueryTab, makeConn } from "../__tests__/queryTabTestHelpers";
import type { QueryResult } from "@/types/query";

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
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
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

function makeDmlResult(rowsAffected: number): QueryResult {
  return {
    columns: [],
    rows: [],
    total_count: rowsAffected,
    execution_time_ms: 5,
    query_type: { dml: { rows_affected: rowsAffected } },
  };
}

function seedTab(sql: string) {
  const tab = makeQueryTab({ sql });
  useWorkspaceStore.setState(seedWorkspace([tab], tab.id));
  useConnectionStore.setState({
    connections: [makeConn({ id: "conn1", environment: "development" })],
  });
  return tab;
}

describe("useQueryExecution — Sprint 254 dry-run WARN escalation", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    cancelQueryMock.mockReset();
    findDocumentsMock.mockReset();
    aggregateDocumentsMock.mockReset();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "warn" });
  });

  // [AC-254-06a] dry-run 150 rows → STOP escalate (pendingRdbConfirm mount,
  // pendingRdbWarn null, executeQuery NOT called).
  it("[AC-254-06a] UPDATE WHERE dry-run rowCount=150 → STOP escalate (pendingRdbConfirm)", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([makeDmlResult(150)]);
    const tab = seedTab("UPDATE users SET name = 'a' WHERE active = true");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbConfirm).not.toBeNull();
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
    // dry-run IPC fired exactly once with the WARN bounded statement.
    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    expect(executeQueryDryRunMock).toHaveBeenCalledWith(
      "conn1",
      ["UPDATE users SET name = 'a' WHERE active = true"],
      expect.stringMatching(/^dry-escalate:/),
    );
    // STOP reason references the threshold so the dialog body can hint
    // at why escalation occurred.
    expect(result.current.pendingRdbConfirm!.reason).toMatch(/100\+ rows/);
  });

  // [AC-254-06b] dry-run 50 rows → WARN preserved (pendingRdbWarn mount,
  // pendingRdbConfirm null).
  it("[AC-254-06b] DELETE WHERE dry-run rowCount=50 → WARN preserved (pendingRdbWarn)", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([makeDmlResult(50)]);
    const tab = seedTab("DELETE FROM logs WHERE level = 'debug'");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbWarn).not.toBeNull();
    });
    expect(result.current.pendingRdbConfirm).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
  });

  // [AC-254-06c] dry-run timeout (2s) → STOP fallback.
  it("[AC-254-06c] UPDATE WHERE dry-run timeout → STOP fallback (pendingRdbConfirm)", async () => {
    // Pending promise that never resolves — exceeds the 2s helper
    // timeout. We use vi.useFakeTimers + advanceTimersByTime so the test
    // doesn't wait the full 2 seconds in real time.
    vi.useFakeTimers();
    executeQueryDryRunMock.mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    const tab = seedTab("UPDATE users SET name = 'a' WHERE active = true");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    let executePromise: Promise<void>;
    act(() => {
      executePromise = result.current.handleExecute();
    });
    // Advance past the 2s timeout. handleExecute is awaiting the helper
    // race; once the timer fires the race resolves with "__timeout__".
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    vi.useRealTimers();
    await act(async () => {
      await executePromise!;
    });

    expect(result.current.pendingRdbConfirm).not.toBeNull();
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  // [AC-254-06d] dry-run IPC throws (Unsupported) → STOP fallback.
  it("[AC-254-06d] DELETE WHERE dry-run IPC throws → STOP fallback (pendingRdbConfirm)", async () => {
    executeQueryDryRunMock.mockRejectedValueOnce(
      new Error("Dry-run unsupported by adapter"),
    );
    const tab = seedTab("DELETE FROM logs WHERE level = 'debug'");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbConfirm).not.toBeNull();
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  // [AC-403-06] INSERT (INFO) → 직접 IPC, warn dialog / dry-run skip.
  it("[AC-403-06] INSERT INTO → INFO direct IPC (no WARN dialog, no dry-run)", async () => {
    executeQueryMock.mockResolvedValueOnce(makeDmlResult(1));
    const tab = seedTab("INSERT INTO users (id) VALUES (1)");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(result.current.pendingRdbConfirm).toBeNull();
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  // [AC-254-06f] SELECT (INFO) → 직접 IPC, escalation 분기 도달 X.
  it("[AC-254-06f] SELECT → INFO direct IPC (no dry-run probe, no WARN dialog)", async () => {
    executeQueryMock.mockResolvedValueOnce(makeDmlResult(0));
    const tab = seedTab("SELECT * FROM users");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(executeQueryMock).toHaveBeenCalledTimes(1);
    });
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(result.current.pendingRdbConfirm).toBeNull();
  });

  // [AC-254-06g] WHERE-less DELETE (DANGER) → STOP confirm 그대로, dry-run
  // 분기 도달 X. SafeMode gate 가 confirm 으로 routing 하므로 escalation
  // helper 자체가 호출되지 않는다.
  it("[AC-254-06g] DELETE without WHERE → STOP via SafeMode gate (no dry-run probe)", async () => {
    const tab = seedTab("DELETE FROM users");
    // production environment so the SafeMode matrix raises confirm.
    // (seedTab seeds development by default — override after.)
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", environment: "production" })],
    });
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbConfirm).not.toBeNull();
    });
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  // [AC-254-06h] 다중 statement: INFO + WARN UPDATE escalates → STOP wins.
  // 다중 statement 의 worst-tier 결정 (STOP > WARN > INFO) 와 escalation 의
  // 정합성 가드.
  it("[AC-254-06h] multi (SELECT + UPDATE WHERE 200 rows) → STOP escalate, batch routed to pendingRdbConfirm", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([makeDmlResult(200)]);
    const tab = seedTab(
      "SELECT 1; UPDATE users SET name = 'a' WHERE active = true",
    );
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbConfirm).not.toBeNull();
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    // Confirm payload covers the WHOLE batch (per AC-231-02 — single
    // dialog per batch).
    expect(result.current.pendingRdbConfirm!.statements).toEqual([
      "SELECT 1",
      "UPDATE users SET name = 'a' WHERE active = true",
    ]);
    expect(executeQueryMock).not.toHaveBeenCalled();
  });
});
