import { executeQuery, executeQueryDryRun } from "@lib/tauri";
import { syncMismatchedActiveDb } from "@lib/runtime/recovery/syncMismatchedActiveDb";
import { getDbMismatchInfo, getTauriErrorMessage } from "@lib/tauri/error";
import { splitSqlStatements } from "@lib/sql/sqlUtils";
import { stripSqlComments } from "@lib/sql/stripSqlComments";
import { parseFromContext, tokenizeSql } from "@lib/completion/shared";
import { findMysqlScriptingBoundaryViolation } from "@lib/sql/mysqlScriptingBoundary";
import {
  analyzeRdbStatementForDialect,
  decideOracleOrGenericSafeMode,
} from "@lib/sql/oracleSafety";
import { escalateWarnIfLargeImpact } from "@lib/sql/escalateWarnIfLargeImpact";
import { toast } from "@lib/runtime/toast";
import { dispatchDbMutationHint } from "./queryHelpers";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import type { DatabaseType } from "@/types/connection";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
} from "@/types/query";
import type { QueryHistorySource } from "@stores/queryHistoryStore";
import type { QueryTab } from "@stores/workspaceStore";
import type { MultiStatementPayload } from "@stores/workspaceStore/types";

type RdbHistoryStatus = "success" | "error" | "cancelled";

export interface RdbHistoryPayload {
  sql: string;
  executedAt: number;
  duration: number;
  status: RdbHistoryStatus;
  source?: QueryHistorySource;
  collection?: string | null;
}

export interface RdbHistoryOverrides {
  source?: QueryHistorySource;
  collection?: string | null;
}

export type RdbSingleRunner = (
  stmt: string,
  history?: RdbHistoryOverrides,
) => Promise<void>;
export type RdbBatchRunner = (
  statements: string[],
  joinedSql: string,
) => Promise<void>;

interface RdbRunnerRef<T> {
  current: T | null;
}

type RdbTabContext = Pick<
  QueryTab,
  "id" | "connectionId" | "paradigm" | "sql" | "queryState"
>;

interface RdbSharedLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  cancelRunningQuery: (tabId: string, queryId: string, message: string) => void;
  clearSchemaForConnection: (connectionId: string) => void;
  recordHistory: (payload: RdbHistoryPayload) => void;
}

interface RdbSingleLifecycleActions extends RdbSharedLifecycleActions {
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
}

interface RdbBatchLifecycleActions extends RdbSharedLifecycleActions {
  completeMultiStatementQuery: (
    tabId: string,
    queryId: string,
    payload: MultiStatementPayload,
  ) => void;
}

interface RdbDryRunActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeQueryDryRun: (
    tabId: string,
    queryId: string,
    result: QueryResult,
    statements?: QueryStatementResult[],
  ) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
}

interface PrepareRdbStatementsResult {
  statements: string[];
  scriptingViolationMessage: string | null;
}

export interface ExecuteRdbSingleStatementRequest extends RdbSingleLifecycleActions {
  tab: RdbTabContext;
  stmt: string;
  history?: RdbHistoryOverrides;
  workspaceDb: string | null | undefined;
  findLiveIdleTab: (tabId: string, connectionId: string) => QueryTab | null;
  runRdbSingleRef: RdbRunnerRef<RdbSingleRunner>;
}

export interface ExecuteRdbStatementBatchRequest extends RdbBatchLifecycleActions {
  tab: RdbTabContext;
  statements: string[];
  joinedSql: string;
  workspaceDb: string | null | undefined;
  findLiveIdleTab: (tabId: string, connectionId: string) => QueryTab | null;
  runRdbBatchRef: RdbRunnerRef<RdbBatchRunner>;
}

export interface ExecuteRdbQueryRequest {
  tab: RdbTabContext;
  sql: string;
  dbType: DatabaseType | null | undefined;
  fileAnalyticsSources?: FileAnalyticsSourceMetadata[];
  decideSafeMode: SafeModeGate["decide"];
  updateQueryState: (tabId: string, state: QueryState) => void;
  recordHistory: (payload: RdbHistoryPayload) => void;
  setPendingRdbConfirm: (pending: {
    statements: string[];
    reason: string;
  }) => void;
  setPendingRdbWarn: (pending: { statements: string[] }) => void;
  runRdbSingle: RdbSingleRunner;
  runRdbBatch: RdbBatchRunner;
}

export interface ExecuteRdbDryRunRequest extends RdbDryRunActions {
  tab: RdbTabContext;
  dbType: DatabaseType | null | undefined;
  workspaceDb: string | null | undefined;
}

function prepareRdbStatements(
  sql: string,
  dbType: DatabaseType | null | undefined,
): PrepareRdbStatementsResult {
  const rawStatements = splitSqlStatements(sql);
  const scriptingViolation = findMysqlScriptingBoundaryViolation(
    rawStatements,
    dbType,
  );
  const statements = rawStatements.filter((stmt) => {
    return stripSqlComments(stmt).trim().length > 0;
  });
  return {
    statements,
    scriptingViolationMessage: scriptingViolation?.message ?? null,
  };
}

function isQueryCancellationMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.startsWith("cancel:") ||
    normalized.includes("query cancelled") ||
    normalized.includes("query canceled") ||
    normalized.includes("operation cancelled") ||
    normalized.includes("operation canceled") ||
    normalized.includes("canceling statement due to user request") ||
    normalized.includes("cancelling statement due to user request")
  );
}

function firstMeaningfulToken(sql: string): string | null {
  const token = tokenizeSql(sql).find(
    (item) => item.kind !== "whitespace" && item.kind !== "comment",
  );
  return token?.text.toUpperCase() ?? null;
}

function normalizeRelationName(value: string): string {
  const parts = value.split(".");
  return parts[parts.length - 1]?.toLowerCase() ?? value.toLowerCase();
}

function resolveFileAnalyticsHistory(
  sql: string,
  dbType: DatabaseType | null | undefined,
  sources: FileAnalyticsSourceMetadata[] | undefined,
): RdbHistoryOverrides | undefined {
  if (dbType !== "duckdb" || !sources || sources.length === 0) {
    return undefined;
  }
  if (firstMeaningfulToken(sql) !== "SELECT") {
    return undefined;
  }
  const relationNames = new Set(
    parseFromContext(sql).tables.map(normalizeRelationName),
  );
  const matched = sources.filter((metadata) =>
    relationNames.has(metadata.source.alias.toLowerCase()),
  );
  if (matched.length === 0) return undefined;
  return {
    source: "file-analytics",
    collection:
      matched.length === 1
        ? matched[0]!.source.fileName
        : `${matched.length} file sources`,
  };
}

export async function executeRdbSingleStatement({
  tab,
  stmt,
  history,
  workspaceDb,
  updateQueryState,
  completeQuery,
  failQuery,
  cancelRunningQuery,
  clearSchemaForConnection,
  recordHistory,
  findLiveIdleTab,
  runRdbSingleRef,
}: ExecuteRdbSingleStatementRequest): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  updateQueryState(tab.id, { status: "running", queryId });
  try {
    const result = await executeQuery(
      tab.connectionId,
      stmt,
      queryId,
      workspaceDb ?? undefined,
    );
    completeQuery(tab.id, queryId, result);
    if (result.queryType === "ddl") {
      clearSchemaForConnection(tab.connectionId);
    }
    recordHistory({
      sql: stmt,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      ...history,
    });
  } catch (err) {
    const message = getTauriErrorMessage(err);
    const dbMismatch = getDbMismatchInfo(err);
    const wasCancelled = isQueryCancellationMessage(message);
    if (wasCancelled) {
      cancelRunningQuery(tab.id, queryId, "Query cancelled");
    } else {
      failQuery(tab.id, queryId, message);
    }
    recordHistory({
      sql: stmt,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: wasCancelled ? "cancelled" : "error",
      ...history,
    });
    if (!wasCancelled && dbMismatch) {
      const capturedTabId = tab.id;
      const capturedConnectionId = tab.connectionId;
      const capturedStmt = stmt;
      const capturedHistory = history;
      void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
        toast.warning(
          `Active DB synced to '${actual}'. Re-run the query if needed.`,
          {
            action: {
              label: "Retry",
              onClick: () => {
                const live = findLiveIdleTab(
                  capturedTabId,
                  capturedConnectionId,
                );
                if (!live) return;
                const fn = runRdbSingleRef.current;
                if (!fn) return;
                void fn(capturedStmt, capturedHistory);
              },
            },
          },
        );
      });
    }
  }
  dispatchDbMutationHint(tab.connectionId, tab.paradigm, stmt);
}

export async function executeRdbStatementBatch({
  tab,
  statements,
  joinedSql,
  workspaceDb,
  updateQueryState,
  completeMultiStatementQuery,
  cancelRunningQuery,
  clearSchemaForConnection,
  recordHistory,
  findLiveIdleTab,
  runRdbBatchRef,
}: ExecuteRdbStatementBatchRequest): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  updateQueryState(tab.id, { status: "running", queryId });

  let lastResult: QueryResult | null = null;
  const statementResults: QueryStatementResult[] = [];
  let mismatchToastPushed = false;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i]!;
    const stmtStart = Date.now();
    try {
      const result = await executeQuery(
        tab.connectionId,
        stmt,
        queryId,
        workspaceDb ?? undefined,
      );
      lastResult = result;
      statementResults.push({
        sql: stmt,
        status: "success",
        result,
        durationMs: Date.now() - stmtStart,
      });
    } catch (err) {
      const message = getTauriErrorMessage(err);
      const dbMismatch = getDbMismatchInfo(err);
      const wasCancelled = isQueryCancellationMessage(message);
      if (wasCancelled) {
        cancelRunningQuery(tab.id, queryId, "Query cancelled");
        recordHistory({
          sql: joinedSql,
          executedAt: Date.now(),
          duration: Date.now() - startTime,
          status: "cancelled",
        });
        return;
      }
      statementResults.push({
        sql: stmt,
        status: "error",
        error: message,
        durationMs: Date.now() - stmtStart,
      });
      if (dbMismatch && !mismatchToastPushed) {
        mismatchToastPushed = true;
        const capturedTabId = tab.id;
        const capturedConnectionId = tab.connectionId;
        const capturedStatements = statements;
        const capturedJoinedSql = joinedSql;
        void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
          toast.warning(
            `Active DB synced to '${actual}'. Re-run the query if needed.`,
            {
              action: {
                label: "Retry",
                onClick: () => {
                  const live = findLiveIdleTab(
                    capturedTabId,
                    capturedConnectionId,
                  );
                  if (!live) return;
                  const fn = runRdbBatchRef.current;
                  if (!fn) return;
                  void fn(capturedStatements, capturedJoinedSql);
                },
              },
            },
          );
        });
      } else if (dbMismatch) {
        void syncMismatchedActiveDb(tab.connectionId, () => {
          /* no toast on repeat - keep queue uncluttered */
        });
      }
    }
  }

  const successCount = statementResults.filter(
    (s) => s.status === "success",
  ).length;
  const allFailed = successCount === 0;
  const batchHasDdl = statementResults.some(
    (s) => s.status === "success" && s.result?.queryType === "ddl",
  );
  if (batchHasDdl) {
    clearSchemaForConnection(tab.connectionId);
  }

  const joinedErrors = statementResults
    .map((s, idx) => `Statement ${idx + 1}: ${s.error ?? ""}`)
    .join("\n");
  completeMultiStatementQuery(tab.id, queryId, {
    statementResults,
    lastResult,
    allFailed,
    joinedErrorMessage: joinedErrors,
  });

  recordHistory({
    sql: joinedSql,
    executedAt: Date.now(),
    duration: Date.now() - startTime,
    status: successCount === statements.length ? "success" : "error",
  });
  dispatchDbMutationHint(tab.connectionId, tab.paradigm, joinedSql);
}

export async function executeRdbQuery({
  tab,
  sql,
  dbType,
  fileAnalyticsSources,
  decideSafeMode,
  updateQueryState,
  recordHistory,
  setPendingRdbConfirm,
  setPendingRdbWarn,
  runRdbSingle,
  runRdbBatch,
}: ExecuteRdbQueryRequest): Promise<void> {
  const { statements, scriptingViolationMessage } = prepareRdbStatements(
    sql,
    dbType,
  );
  if (scriptingViolationMessage) {
    updateQueryState(tab.id, {
      status: "error",
      error: scriptingViolationMessage,
    });
    recordHistory({
      sql,
      executedAt: Date.now(),
      duration: 0,
      status: "error",
    });
    return;
  }
  if (statements.length === 0) return;
  const fileAnalyticsHistory =
    statements.length === 1
      ? resolveFileAnalyticsHistory(sql, dbType, fileAnalyticsSources)
      : undefined;

  let worstAction: "allow" | "confirm" | "block" = "allow";
  let worstReason = "";
  let hasWarn = false;
  const escalationCandidates: { stmt: string; reason: string }[] = [];
  for (const stmt of statements) {
    const dialect =
      dbType === "mssql" || dbType === "oracle" ? dbType : undefined;
    const analysis = analyzeRdbStatementForDialect(stmt, dialect);
    const decision = decideOracleOrGenericSafeMode(analysis, decideSafeMode);
    if (decision.action === "block") {
      worstAction = "block";
      worstReason = decision.reason;
      break;
    }
    if (decision.action === "confirm" && worstAction === "allow") {
      worstAction = "confirm";
      worstReason = decision.reason;
    }
    if (decision.action === "allow" && analysis.severity === "warn") {
      hasWarn = true;
      if (analysis.kind === "dml-update" || analysis.kind === "dml-delete") {
        escalationCandidates.push({
          stmt,
          reason:
            analysis.kind === "dml-update"
              ? "UPDATE affects 100+ rows (dry-run threshold)"
              : "DELETE affects 100+ rows (dry-run threshold)",
        });
      }
    }
  }

  if (worstAction === "block") {
    updateQueryState(tab.id, { status: "error", error: worstReason });
    recordHistory({
      sql,
      executedAt: Date.now(),
      duration: 0,
      status: "error",
    });
    return;
  }
  if (worstAction === "confirm") {
    setPendingRdbConfirm({ statements, reason: worstReason });
    return;
  }
  if (hasWarn && escalationCandidates.length > 0) {
    for (const candidate of escalationCandidates) {
      const escalated = await escalateWarnIfLargeImpact(
        tab.connectionId,
        candidate.stmt,
        "warn",
      );
      if (escalated === "danger") {
        setPendingRdbConfirm({ statements, reason: candidate.reason });
        return;
      }
    }
  }
  if (hasWarn) {
    setPendingRdbWarn({ statements });
    return;
  }

  if (statements.length === 1) {
    await runRdbSingle(sql, fileAnalyticsHistory);
    return;
  }
  await runRdbBatch(statements, sql);
}

export async function executeRdbDryRun({
  tab,
  dbType,
  workspaceDb,
  updateQueryState,
  completeQueryDryRun,
  failQuery,
}: ExecuteRdbDryRunRequest): Promise<void> {
  if (tab.queryState.status === "running") return;
  const sql = tab.sql.trim();
  if (!sql) return;

  const { statements, scriptingViolationMessage } = prepareRdbStatements(
    sql,
    dbType,
  );
  if (scriptingViolationMessage) {
    updateQueryState(tab.id, {
      status: "error",
      error: scriptingViolationMessage,
    });
    return;
  }
  if (statements.length === 0) return;

  const queryId = `dry:${tab.id}-${Date.now()}`;
  updateQueryState(tab.id, { status: "running", queryId });
  try {
    const results = await executeQueryDryRun(
      tab.connectionId,
      statements,
      queryId,
      workspaceDb ?? undefined,
    );
    if (results.length <= 1) {
      const lastResult: QueryResult =
        results[0] ??
        ({
          columns: [],
          rows: [],
          totalCount: 0,
          executionTimeMs: 0,
          queryType: "ddl",
        } satisfies QueryResult);
      completeQueryDryRun(tab.id, queryId, lastResult);
      return;
    }
    const statementResults: QueryStatementResult[] = results.map(
      (res, idx) => ({
        sql: statements[idx] ?? "",
        status: "success" as const,
        result: res,
        durationMs: res.executionTimeMs,
      }),
    );
    const lastResult = results[results.length - 1]!;
    completeQueryDryRun(tab.id, queryId, lastResult, statementResults);
  } catch (err) {
    const message = getTauriErrorMessage(err);
    failQuery(tab.id, queryId, message);
    if (getDbMismatchInfo(err)) {
      const capturedConnectionId = tab.connectionId;
      void syncMismatchedActiveDb(capturedConnectionId, (actual) => {
        toast.warning(
          `Active DB synced to '${actual}'. Re-run the dry-run if needed.`,
        );
      });
    }
  }
}
