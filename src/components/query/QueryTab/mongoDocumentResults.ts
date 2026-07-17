import {
  aggregateDocuments,
  countDocuments,
  distinctDocuments,
  estimatedDocumentCount,
  findDocuments,
  findOneDocument,
} from "@lib/tauri";
import { getTauriErrorMessage } from "@lib/tauri/error";
import type { DocumentRecordHistoryQueryMode } from "@lib/runtime/history/recordHistoryEntry";
import type { FindBody } from "@/types/document";
import {
  createDocumentResultEnvelope,
  requireCompatibleQueryResult,
  type QueryResult,
} from "@/types/query";
import type {
  ExecuteMongoAggregateRequest,
  MongoLifecycleActions,
  MongoTabContext,
} from "./mongoQueryExecution";
import { isQueryCancellationMessage } from "./queryCancellation";

/**
 * Issue #1561 — shared catch handler for every mongo query runner (find /
 * findOne / count / estimatedCount / distinct / aggregate + admin runCommand).
 * A user cancel returns `AppError::Database("Operation cancelled")`; routing it
 * to `cancelRunningQuery` + history "cancelled" (instead of `failQuery` +
 * "error") keeps the document paradigm consistent with RDB/Search — the user's
 * own cancel is never surfaced as a red error banner.
 */
export function handleMongoRunnerError(
  actions: Pick<
    MongoLifecycleActions,
    "failQuery" | "cancelRunningQuery" | "recordHistory"
  >,
  err: unknown,
  ctx: {
    tabId: string;
    queryId: string;
    sql: string;
    startTime: number;
    queryMode?: DocumentRecordHistoryQueryMode;
  },
): void {
  const message = getTauriErrorMessage(err);
  const wasCancelled = isQueryCancellationMessage(message);
  if (wasCancelled) {
    actions.cancelRunningQuery(ctx.tabId, ctx.queryId, "Query cancelled");
  } else {
    actions.failQuery(ctx.tabId, ctx.queryId, message);
  }
  actions.recordHistory({
    sql: ctx.sql,
    executedAt: Date.now(),
    duration: Date.now() - ctx.startTime,
    status: wasCancelled ? "cancelled" : "error",
    queryMode: ctx.queryMode,
  });
}

export async function executeMongoAggregate({
  tab,
  pipeline,
  collectionOverride,
  updateQueryState,
  completeQuery,
  failQuery,
  cancelRunningQuery,
  recordHistory,
}: ExecuteMongoAggregateRequest): Promise<void> {
  const resolvedDatabase = tab.database;
  const resolvedCollection =
    collectionOverride ??
    (tab.database && tab.collection ? tab.collection : undefined);
  if (!resolvedDatabase || !resolvedCollection) {
    updateQueryState(tab.id, {
      status: "error",
      error:
        "Select a target database from the toolbar chip, then type a mongosh expression (e.g. `db.users.find({})`).",
    });
    return;
  }
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  updateQueryState(tab.id, { status: "running", queryId });
  try {
    const docResult = await aggregateDocuments(
      tab.connectionId,
      resolvedDatabase,
      resolvedCollection,
      pipeline,
      queryId,
    );
    const queryResult = requireCompatibleQueryResult(
      createDocumentResultEnvelope(docResult),
    );
    completeQuery(tab.id, queryId, queryResult);
    recordHistory({
      sql: tab.sql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "aggregate",
    });
  } catch (err) {
    handleMongoRunnerError(
      { failQuery, cancelRunningQuery, recordHistory },
      err,
      {
        tabId: tab.id,
        queryId,
        sql: tab.sql,
        startTime,
        queryMode: "aggregate",
      },
    );
  }
}

export async function runDocumentFind(
  actions: MongoLifecycleActions,
  tab: MongoTabContext,
  connectionId: string,
  database: string,
  collection: string,
  body: FindBody,
  rawSql: string,
): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  actions.updateQueryState(tab.id, { status: "running", queryId });
  try {
    const docResult = await findDocuments(
      connectionId,
      database,
      collection,
      body,
      queryId,
    );
    const queryResult = requireCompatibleQueryResult(
      createDocumentResultEnvelope(docResult),
    );
    actions.completeQuery(tab.id, queryId, queryResult);
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "find",
    });
  } catch (err) {
    handleMongoRunnerError(actions, err, {
      tabId: tab.id,
      queryId,
      sql: rawSql,
      startTime,
      queryMode: "find",
    });
  }
}

export async function runDocumentFindOne(
  actions: MongoLifecycleActions,
  tab: MongoTabContext,
  connectionId: string,
  database: string,
  collection: string,
  filter: Record<string, unknown> | undefined,
  rawSql: string,
): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  actions.updateQueryState(tab.id, { status: "running", queryId });
  try {
    const docRow = await findOneDocument(
      connectionId,
      database,
      collection,
      filter,
      queryId,
    );
    const queryResult: QueryResult =
      docRow === null
        ? {
            columns: [],
            rows: [],
            totalCount: 0,
            executionTimeMs: Date.now() - startTime,
            queryType: "select",
            resultUnit: "document",
          }
        : {
            columns: docRow.columns,
            rows: [docRow.row],
            totalCount: 1,
            executionTimeMs: Date.now() - startTime,
            queryType: "select",
            resultUnit: "document",
          };
    actions.completeQuery(tab.id, queryId, queryResult);
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "findOne",
    });
  } catch (err) {
    handleMongoRunnerError(actions, err, {
      tabId: tab.id,
      queryId,
      sql: rawSql,
      startTime,
      queryMode: "findOne",
    });
  }
}

export async function runDocumentCount(
  actions: MongoLifecycleActions,
  tab: MongoTabContext,
  connectionId: string,
  database: string,
  collection: string,
  filter: Record<string, unknown> | undefined,
  rawSql: string,
): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  actions.updateQueryState(tab.id, { status: "running", queryId });
  try {
    const count = await countDocuments(
      connectionId,
      database,
      collection,
      filter,
      queryId,
    );
    const queryResult: QueryResult = {
      columns: [{ name: "count", dataType: "Int64", category: "int" }],
      rows: [[count]],
      totalCount: 1,
      executionTimeMs: Date.now() - startTime,
      queryType: "select",
      resultKind: "scalar",
    };
    actions.completeQuery(tab.id, queryId, queryResult);
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "countDocuments",
    });
  } catch (err) {
    handleMongoRunnerError(actions, err, {
      tabId: tab.id,
      queryId,
      sql: rawSql,
      startTime,
      queryMode: "countDocuments",
    });
  }
}

export async function runDocumentEstimatedCount(
  actions: MongoLifecycleActions,
  tab: MongoTabContext,
  connectionId: string,
  database: string,
  collection: string,
  rawSql: string,
): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  actions.updateQueryState(tab.id, { status: "running", queryId });
  try {
    const count = await estimatedDocumentCount(
      connectionId,
      database,
      collection,
      queryId,
    );
    const queryResult: QueryResult = {
      columns: [{ name: "count", dataType: "Int64", category: "int" }],
      rows: [[count]],
      totalCount: 1,
      executionTimeMs: Date.now() - startTime,
      queryType: "select",
      resultKind: "scalar",
    };
    actions.completeQuery(tab.id, queryId, queryResult);
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "estimatedDocumentCount",
    });
  } catch (err) {
    handleMongoRunnerError(actions, err, {
      tabId: tab.id,
      queryId,
      sql: rawSql,
      startTime,
      queryMode: "estimatedDocumentCount",
    });
  }
}

export async function runDocumentDistinct(
  actions: MongoLifecycleActions,
  tab: MongoTabContext,
  connectionId: string,
  database: string,
  collection: string,
  field: string,
  filter: Record<string, unknown> | undefined,
  rawSql: string,
): Promise<void> {
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  actions.updateQueryState(tab.id, { status: "running", queryId });
  try {
    const values = await distinctDocuments(
      connectionId,
      database,
      collection,
      field,
      filter,
      queryId,
    );
    const queryResult: QueryResult = {
      columns: [{ name: "value", dataType: "string", category: "text" }],
      rows: values.map((v) => [v]),
      totalCount: values.length,
      executionTimeMs: Date.now() - startTime,
      queryType: "select",
      resultKind: "list",
    };
    actions.completeQuery(tab.id, queryId, queryResult);
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "success",
      queryMode: "distinct",
    });
  } catch (err) {
    handleMongoRunnerError(actions, err, {
      tabId: tab.id,
      queryId,
      sql: rawSql,
      startTime,
      queryMode: "distinct",
    });
  }
}
