// Verifies the dry-run row-count escalation in
// `useQueryExecution.handleExecute`. The core protection behind ADR 0023
// grill Q2-(a): a WARN-tier bounded UPDATE/DELETE whose dry-run reports
// 100+ rows escalates automatically to STOP (`pendingRdbConfirm`).
//
// Scenarios (written red-fail first):
//   - dry-run 100+ row → STOP escalate (pendingRdbConfirm mount).
//   - dry-run < 100 row → WARN preserved (pendingRdbWarn mount).
//   - dry-run timeout (2s) → STOP fallback.
//   - dry-run IPC unsupported / throws → STOP fallback.
//   - INSERT (INFO) → direct IPC, escalation skipped.
//   - INFO statement (SELECT) → direct IPC, escalation skipped.
//   - DANGER statement (DROP) → STOP confirm as is, escalation branch
//     never reached.
//
// Whether `useQueryExecution` can be mounted directly (renderHook)
// follows the pattern of the other dry-run.test.ts (avoid a full
// QueryTab mount).

import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { QueryResult } from "@/types/query";
import { makeConn, makeQueryTab } from "../__tests__/queryTabTestHelpers";
import { useQueryExecution } from "./useQueryExecution";

const executeQueryMock = vi.fn();
const executeQueryDryRunMock = vi.fn();
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
    totalCount: rowsAffected,
    executionTimeMs: 5,
    queryType: { dml: { rows_affected: rowsAffected } },
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

  // [AC-403-06] INSERT (INFO) → direct IPC, warn dialog / dry-run skipped.
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

  // [AC-254-06f] SELECT (INFO) → direct IPC, escalation branch never
  // reached.
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

  // [AC-254-06g] WHERE-less DELETE (DANGER) → STOP confirm as is, the
  // dry-run branch is never reached. The SafeMode gate routes to confirm,
  // so the escalation helper is not called at all.
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

  // ── Issue #2375 — escalation path unchanged by the wider gate ─────────
  //
  // The preview mount condition and the dry-run escalation condition
  // shared a single `hasWarn` flag. Editing that one line just to widen
  // the preview would push an already-danger statement into the
  // escalation path, making the `"warn"` baseline that
  // `escalateWarnIfLargeImpact` receives false and attaching a pointless
  // dry-run count query. `[AC-2375-03]` and `[AC-2375-04]` below measure
  // whether the flags really did split.

  it("[AC-2375-03] preview[danger] DELETE without WHERE (비프로덕션) → 미리보기, dry-run 프로브 미발동", async () => {
    const tab = seedTab("DELETE FROM users");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbWarn).not.toBeNull();
    });
    expect(result.current.pendingRdbConfirm).toBeNull();
    expect(executeQueryMock).not.toHaveBeenCalled();
    // Key point: danger is not an escalation candidate. If the probe
    // goes out even once, the preview condition and the escalation
    // condition still share one flag.
    expect(executeQueryDryRunMock).not.toHaveBeenCalled();
  });

  it("[AC-2375-04] DELETE WHERE dry-run rowCount=120 → STOP escalate 그대로 (승격 경로 회귀)", async () => {
    executeQueryDryRunMock.mockResolvedValueOnce([makeDmlResult(120)]);
    const tab = seedTab("DELETE FROM logs WHERE level = 'debug'");
    const { result } = renderHook(() => useQueryExecution({ tab }));

    await act(async () => {
      await result.current.handleExecute();
    });

    await waitFor(() => {
      expect(result.current.pendingRdbConfirm).not.toBeNull();
    });
    expect(result.current.pendingRdbWarn).toBeNull();
    expect(result.current.pendingRdbConfirm!.reason).toMatch(/100\+ rows/);
    expect(executeQueryDryRunMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).not.toHaveBeenCalled();
  });

  // [AC-254-06h] multi-statement: INFO + WARN UPDATE escalates → STOP
  // wins. Guards the consistency between the worst-tier decision across
  // statements (STOP > WARN > INFO) and escalation.
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
