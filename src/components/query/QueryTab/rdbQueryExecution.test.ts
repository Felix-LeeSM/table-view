import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeRdbQuery,
  executeRdbSingleStatement,
  executeRdbStatementBatch,
} from "./rdbQueryExecution";
import type { SafeModeDecision } from "@/lib/safeMode";
import type { TabId } from "@/types/branded";

const executeQueryMock = vi.hoisted(() => vi.fn());
const executeQueryDryRunMock = vi.hoisted(() => vi.fn());
const dispatchDbMutationHintMock = vi.hoisted(() => vi.fn());

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => executeQueryMock(...args),
  executeQueryDryRun: (...args: unknown[]) => executeQueryDryRunMock(...args),
}));

vi.mock("@lib/runtime/recovery/syncMismatchedActiveDb", () => ({
  syncMismatchedActiveDb: vi.fn(),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: vi.fn() },
}));

vi.mock("./queryHelpers", () => ({
  dispatchDbMutationHint: (...args: unknown[]) =>
    dispatchDbMutationHintMock(...args),
}));

const tab = {
  id: "query-rdb" as TabId,
  connectionId: "conn-rdb",
  paradigm: "rdb" as const,
  sql: "SELECT 1",
  queryState: { status: "idle" as const },
};

function createSingleActions() {
  return {
    updateQueryState: vi.fn(),
    completeQuery: vi.fn(),
    failQuery: vi.fn(),
    cancelRunningQuery: vi.fn(),
    clearSchemaForConnection: vi.fn(),
    recordHistory: vi.fn(),
  };
}

describe("rdbQueryExecution seam", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  it("routes typed Cancel envelopes with normalized Cancel prefix to cancellation", async () => {
    executeQueryMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "PermissionDenied", message: "role cannot kill query" },
    });
    const actions = createSingleActions();

    await executeRdbSingleStatement({
      tab,
      stmt: "SELECT 1",
      workspaceDb: "app",
      findLiveIdleTab: vi.fn(),
      runRdbSingleRef: { current: null },
      ...actions,
    });

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-rdb",
      expect.stringMatching(/^query-rdb-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: "SELECT 1",
        status: "cancelled",
      }),
    );
  });

  // Issue #1230 (PR #1241 review) — a MySQL native KILL QUERY surfaces as
  // ER_QUERY_INTERRUPTED (1317). Even if it reaches the frontend un-normalized
  // (backend backstop), it must land on cancelled, not failed — DBMS parity.
  it("routes a MySQL ER_QUERY_INTERRUPTED error to cancellation, not failure", async () => {
    executeQueryMock.mockRejectedValueOnce(
      new Error(
        "error returned from database: Query execution was interrupted",
      ),
    );
    const actions = createSingleActions();

    await executeRdbSingleStatement({
      tab,
      stmt: "SELECT SLEEP(20)",
      workspaceDb: "app",
      findLiveIdleTab: vi.fn(),
      runRdbSingleRef: { current: null },
      ...actions,
    });

    expect(actions.cancelRunningQuery).toHaveBeenCalledWith(
      "query-rdb",
      expect.stringMatching(/^query-rdb-/),
      "Query cancelled",
    );
    expect(actions.failQuery).not.toHaveBeenCalled();
    expect(actions.recordHistory).toHaveBeenCalledWith(
      expect.objectContaining({ sql: "SELECT SLEEP(20)", status: "cancelled" }),
    );
  });
});

// Purpose: #1223 regression — the single-statement dispatch path must send the
// comment-stripped `statements[0]` to the backend, not the raw editor SQL, so a
// trailing `;`-plus-comment tail doesn't reach the driver as a 2nd statement.
// Wires the *real* `executeRdbSingleStatement` as the runner (production parity
// via `runRdbSingleNow`) so the assertion lands on the `executeQuery` IPC
// boundary — the layer the bug actually corrupts.
const allow: SafeModeDecision = { action: "allow" };

function makeProductionSingleRunner(
  actions: ReturnType<typeof createSingleActions>,
) {
  const runRdbSingleRef = { current: null as unknown };
  const runner = (
    stmt: string,
    history?: { source?: string; collection?: string | null },
    safetyConfirmed?: boolean,
  ) =>
    executeRdbSingleStatement({
      tab,
      stmt,
      history: history as never,
      workspaceDb: "app",
      updateQueryState: actions.updateQueryState,
      completeQuery: actions.completeQuery,
      failQuery: actions.failQuery,
      cancelRunningQuery: actions.cancelRunningQuery,
      clearSchemaForConnection: actions.clearSchemaForConnection,
      recordHistory: actions.recordHistory,
      findLiveIdleTab: vi.fn(),
      runRdbSingleRef: runRdbSingleRef as never,
      safetyConfirmed,
    });
  runRdbSingleRef.current = runner;
  return runner;
}

async function runSinglePath(sql: string) {
  executeQueryMock.mockResolvedValue({
    columns: [],
    rows: [],
    totalCount: 0,
    executionTimeMs: 0,
    queryType: "select",
  });
  const actions = createSingleActions();
  await executeRdbQuery({
    tab: { ...tab, sql },
    sql,
    dbType: "postgresql",
    decideSafeMode: () => allow,
    updateQueryState: actions.updateQueryState,
    recordHistory: actions.recordHistory,
    setPendingRdbConfirm: vi.fn(),
    setPendingRdbWarn: vi.fn(),
    runRdbSingle: makeProductionSingleRunner(actions),
    runRdbBatch: vi.fn(),
  });
}

describe("executeRdbQuery single-statement routing (#1223)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  // Reason: 사용자 보고 (2026-07-03) — RAW Query 밑에 주석 추가 시 syntax error.
  // 원인: 단일 경로가 정제된 statements[0] 대신 원본 sql 재주입 (#1223).
  it("sends the comment-stripped statement to executeQuery when a single statement has a trailing comment", async () => {
    await runSinglePath("SELECT * FROM users;\n-- trailing comment");

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn-rdb",
      "SELECT * FROM users",
      expect.stringMatching(/^query-rdb-/),
      "app",
      undefined,
    );
  });

  // Reason: #1223 GREEN 불변 — inline 주석은 statements[0] 안에 보존되어야 하므로
  // 단일 stmt `SELECT 1 -- x` 는 fix 전후 동일하게 주석 포함 전문이 전달된다.
  it("preserves an inline trailing comment inside a single statement", async () => {
    await runSinglePath("SELECT 1 -- keep me");

    expect(executeQueryMock).toHaveBeenCalledTimes(1);
    expect(executeQueryMock).toHaveBeenCalledWith(
      "conn-rdb",
      "SELECT 1 -- keep me",
      expect.stringMatching(/^query-rdb-/),
      "app",
      undefined,
    );
  });
});

// Issue #1116 — a MERGE ... WHEN MATCHED THEN DELETE is a bounded write (warn)
// but must participate in dry-run impact escalation exactly like a DELETE WHERE
// of the same blast radius. Before the fix, `dml-merge` was excluded from the
// escalation whitelist, so a MERGE deleting 100+ rows landed on the 1-click
// warn preview instead of the confirm gate ("same risk = same gate").
async function runMergeEscalationPath(sql: string, dryRunRows: number) {
  executeQueryMock.mockResolvedValue({
    columns: [],
    rows: [],
    totalCount: 0,
    executionTimeMs: 0,
    queryType: "select",
  });
  executeQueryDryRunMock.mockResolvedValue([
    {
      columns: [],
      rows: [],
      totalCount: dryRunRows,
      executionTimeMs: 0,
      queryType: { dml: { rows_affected: dryRunRows } },
    },
  ]);
  const actions = createSingleActions();
  const setPendingRdbConfirm = vi.fn();
  const setPendingRdbWarn = vi.fn();
  await executeRdbQuery({
    tab: { ...tab, sql },
    sql,
    dbType: "postgresql",
    decideSafeMode: () => allow,
    updateQueryState: actions.updateQueryState,
    recordHistory: actions.recordHistory,
    setPendingRdbConfirm,
    setPendingRdbWarn,
    runRdbSingle: makeProductionSingleRunner(actions),
    runRdbBatch: vi.fn(),
  });
  return { setPendingRdbConfirm, setPendingRdbWarn };
}

describe("executeRdbQuery MERGE impact escalation (#1116)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  it("escalates a MERGE ... WHEN MATCHED THEN DELETE affecting 100+ rows to the confirm gate", async () => {
    const { setPendingRdbConfirm, setPendingRdbWarn } =
      await runMergeEscalationPath(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
        150,
      );

    expect(setPendingRdbConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "MERGE affects 100+ rows (dry-run threshold)",
      }),
    );
    expect(setPendingRdbWarn).not.toHaveBeenCalled();
  });

  it("keeps a MERGE under the threshold on the warn preview, not the confirm gate", async () => {
    const { setPendingRdbConfirm, setPendingRdbWarn } =
      await runMergeEscalationPath(
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
        3,
      );

    expect(setPendingRdbConfirm).not.toHaveBeenCalled();
    expect(setPendingRdbWarn).toHaveBeenCalledWith({
      statements: [
        "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
      ],
    });
  });
});

// Issue #1110 — the warn-escalation reason must match reality. MySQL/SQLite
// reject the dry-run probe with `Unsupported`, so the confirm dialog can't
// claim a measured "100+ rows" impact for a 1-row UPDATE (or MERGE).
describe("executeRdbQuery warn-escalation reason (#1110)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    executeQueryDryRunMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  async function runWarnStmt(
    sql: string,
    dryRun: () => Promise<unknown>,
    dbType: "mysql" | "postgresql" = "mysql",
  ) {
    executeQueryDryRunMock.mockImplementation(dryRun);
    const setPendingRdbConfirm = vi.fn();
    await executeRdbQuery({
      tab: { ...tab, sql },
      sql,
      dbType,
      decideSafeMode: () => allow,
      updateQueryState: vi.fn(),
      recordHistory: vi.fn(),
      setPendingRdbConfirm,
      setPendingRdbWarn: vi.fn(),
      runRdbSingle: vi.fn(),
      runRdbBatch: vi.fn(),
    });
    return setPendingRdbConfirm;
  }

  it("does NOT claim '100+ rows' when the dry-run probe is unsupported", async () => {
    const setPendingRdbConfirm = await runWarnStmt(
      "UPDATE t SET x = 1 WHERE id = 5",
      () => Promise.reject(new Error("Unsupported")),
    );

    expect(setPendingRdbConfirm).toHaveBeenCalledTimes(1);
    const reason = setPendingRdbConfirm.mock.calls[0]![0].reason as string;
    expect(reason).not.toContain("100+");
    expect(reason).toMatch(/unknown number of rows/i);
    expect(reason).toMatch(/not supported/i);
  });

  it("does NOT claim '100+ rows' for an unsupported-probe MERGE, and names MERGE", async () => {
    const setPendingRdbConfirm = await runWarnStmt(
      "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE",
      () => Promise.reject(new Error("Unsupported")),
      "postgresql",
    );

    expect(setPendingRdbConfirm).toHaveBeenCalledTimes(1);
    const reason = setPendingRdbConfirm.mock.calls[0]![0].reason as string;
    expect(reason).not.toContain("100+");
    expect(reason).toContain("MERGE");
    expect(reason).toMatch(/unknown number of rows/i);
  });

  it("keeps the measured '100+ rows' copy when the probe counts the impact", async () => {
    const setPendingRdbConfirm = await runWarnStmt(
      "UPDATE t SET x = 1 WHERE id = 5",
      () =>
        Promise.resolve([
          {
            columns: [],
            rows: [],
            totalCount: 0,
            executionTimeMs: 0,
            queryType: { dml: { rows_affected: 250 } },
          },
        ]),
    );

    expect(setPendingRdbConfirm).toHaveBeenCalledTimes(1);
    const reason = setPendingRdbConfirm.mock.calls[0]![0].reason as string;
    expect(reason).toContain("100+ rows");
  });
});

// Issue #1089 — stop-on-error is the default for editor multi-statement runs:
// once statement K fails, statements K+1..N must NOT reach the driver, and they
// surface as `skipped` in the per-statement breakdown so the partial-apply
// boundary is explicit. Asserts on the `executeQuery` IPC boundary (call count)
// and on the `completeMultiStatementQuery` payload the result panel consumes.
function okResult() {
  return {
    columns: [],
    rows: [],
    totalCount: 0,
    executionTimeMs: 0,
    queryType: "select" as const,
  };
}

function createBatchActions() {
  return {
    updateQueryState: vi.fn(),
    completeMultiStatementQuery: vi.fn(),
    cancelRunningQuery: vi.fn(),
    clearSchemaForConnection: vi.fn(),
    recordHistory: vi.fn(),
  };
}

async function runBatch(statements: string[]) {
  const actions = createBatchActions();
  await executeRdbStatementBatch({
    tab,
    statements,
    joinedSql: statements.join(";\n"),
    workspaceDb: "app",
    findLiveIdleTab: vi.fn(),
    runRdbBatchRef: { current: null },
    ...actions,
  });
  return actions;
}

describe("executeRdbStatementBatch stop-on-error (#1089)", () => {
  beforeEach(() => {
    executeQueryMock.mockReset();
    dispatchDbMutationHintMock.mockReset();
  });

  it("stops after the first failure and marks later statements skipped", async () => {
    executeQueryMock
      .mockResolvedValueOnce(okResult()) // stmt 1 ok
      .mockRejectedValueOnce(new Error("syntax error at UPDATE")); // stmt 2 fails

    const actions = await runBatch([
      "INSERT INTO t VALUES (1)",
      "UPDATE t SET bad syntax",
      "DELETE FROM t WHERE id = 1",
    ]);

    // stmt 3 (DELETE) must never be sent to the driver.
    expect(executeQueryMock).toHaveBeenCalledTimes(2);

    const payload = actions.completeMultiStatementQuery.mock.calls[0]![2];
    expect(
      payload.statementResults.map((s: { status: string }) => s.status),
    ).toEqual(["success", "error", "skipped"]);
    expect(payload.statementResults[2].sql).toBe("DELETE FROM t WHERE id = 1");
    expect(payload.allFailed).toBe(false);
  });

  it("runs every statement when none fail", async () => {
    executeQueryMock.mockResolvedValue(okResult());

    const actions = await runBatch([
      "INSERT INTO t VALUES (1)",
      "INSERT INTO t VALUES (2)",
    ]);

    expect(executeQueryMock).toHaveBeenCalledTimes(2);
    const payload = actions.completeMultiStatementQuery.mock.calls[0]![2];
    expect(
      payload.statementResults.map((s: { status: string }) => s.status),
    ).toEqual(["success", "success"]);
  });
});
