import {
  aggregateDocuments,
  countDocuments,
  distinctDocuments,
  estimatedDocumentCount,
  findDocuments,
  findOneDocument,
} from "@lib/tauri";
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

export async function executeMongoAggregate({
  tab,
  pipeline,
  collectionOverride,
  updateQueryState,
  completeQuery,
  failQuery,
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
    failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    recordHistory({
      sql: tab.sql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
      queryMode: "aggregate",
    });
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
    actions.failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
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
    actions.failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
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
    actions.failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
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
    actions.failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
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
    actions.failQuery(
      tab.id,
      queryId,
      err instanceof Error ? err.message : String(err),
    );
    actions.recordHistory({
      sql: rawSql,
      executedAt: Date.now(),
      duration: Date.now() - startTime,
      status: "error",
      queryMode: "distinct",
    });
  }
}
