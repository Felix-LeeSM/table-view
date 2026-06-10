import {
  bulkWriteDocuments,
  createMongoIndex,
  deleteDocument,
  deleteMany,
  dropMongoIndex,
  insertDocument,
  insertManyDocuments,
  updateDocument,
  updateMany,
  type CreateMongoIndexRequest,
} from "@lib/tauri";
import { idOnlyFilter } from "@lib/mongo/documentIdentity";
import type { DocumentRecordHistoryQueryMode } from "@lib/runtime/history/recordHistoryEntry";
import type { BulkWriteOp, BulkWriteResult } from "@/types/documentMutate";
import type { QueryResult, QueryState, WriteSummaryData } from "@/types/query";

export type MongoWriteRunner = () => Promise<void>;

export interface MongoWriteRunnerRef {
  current: MongoWriteRunner | null;
}

export interface MongoWriteExecutionActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
  recordHistory: (payload: {
    sql: string;
    executedAt: number;
    duration: number;
    status: "success" | "error" | "cancelled";
    queryMode?: DocumentRecordHistoryQueryMode;
  }) => void;
}

export interface MongoWriteDispatchers {
  runInsertOne: (
    connectionId: string,
    database: string,
    collection: string,
    doc: Record<string, unknown>,
    rawSql: string,
  ) => Promise<void>;
  runInsertMany: (
    connectionId: string,
    database: string,
    collection: string,
    docs: Record<string, unknown>[],
    rawSql: string,
  ) => Promise<void>;
  runDeleteMany: (
    connectionId: string,
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    rawSql: string,
  ) => Promise<void>;
  runUpdateMany: (
    connectionId: string,
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
    rawSql: string,
  ) => Promise<void>;
  runDeleteOne: (
    connectionId: string,
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    rawSql: string,
  ) => Promise<void>;
  runUpdateOne: (
    connectionId: string,
    database: string,
    collection: string,
    filter: Record<string, unknown>,
    patch: Record<string, unknown>,
    rawSql: string,
  ) => Promise<void>;
  runReplaceOne: (
    connectionId: string,
    database: string,
    collection: string,
    op: Extract<BulkWriteOp, { op: "replaceOne" }>,
    rawSql: string,
  ) => Promise<void>;
  runBulkWrite: (
    connectionId: string,
    database: string,
    collection: string,
    ops: readonly BulkWriteOp[],
    rawSql: string,
  ) => Promise<void>;
  runCreateIndex: (
    connectionId: string,
    database: string,
    collection: string,
    request: CreateMongoIndexRequest,
    rawSql: string,
  ) => Promise<void>;
  runDropIndex: (
    connectionId: string,
    database: string,
    collection: string,
    indexName: string,
    rawSql: string,
  ) => Promise<void>;
}

export interface CreateMongoWriteDispatchersRequest extends MongoWriteExecutionActions {
  tabId: string;
}

export function createMongoWriteDispatchers({
  tabId,
  updateQueryState,
  completeQuery,
  failQuery,
  recordHistory,
}: CreateMongoWriteDispatchersRequest): MongoWriteDispatchers {
  async function runWriteHelper(
    queryMode: DocumentRecordHistoryQueryMode,
    rawSql: string,
    writer: () => Promise<WriteSummaryData>,
  ): Promise<void> {
    const queryId = `${tabId}-${Date.now()}`;
    const startTime = Date.now();
    updateQueryState(tabId, { status: "running", queryId });
    try {
      const summary = await writer();
      completeQuery(tabId, queryId, {
        columns: [],
        rows: [],
        totalCount: 0,
        executionTimeMs: Date.now() - startTime,
        queryType: "select",
        resultKind: "writeSummary",
        writeSummary: summary,
      });
      recordHistory({
        sql: rawSql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "success",
        queryMode,
      });
    } catch (err) {
      failQuery(
        tabId,
        queryId,
        err instanceof Error ? err.message : String(err),
      );
      recordHistory({
        sql: rawSql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "error",
        queryMode,
      });
    }
  }

  async function runMongoIndexHelper(
    queryMode: "createIndex" | "dropIndex",
    rawSql: string,
    writer: () => Promise<string>,
  ): Promise<void> {
    const queryId = `${tabId}-${Date.now()}`;
    const startTime = Date.now();
    updateQueryState(tabId, { status: "running", queryId });
    try {
      const indexName = await writer();
      completeQuery(tabId, queryId, {
        columns: [
          { name: "operation", dataType: "string", category: "text" },
          { name: "index", dataType: "string", category: "text" },
        ],
        rows: [[queryMode, indexName]],
        totalCount: 1,
        executionTimeMs: Date.now() - startTime,
        queryType: "ddl",
      });
      recordHistory({
        sql: rawSql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "success",
        queryMode,
      });
    } catch (err) {
      failQuery(
        tabId,
        queryId,
        err instanceof Error ? err.message : String(err),
      );
      recordHistory({
        sql: rawSql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "error",
        queryMode,
      });
    }
  }

  return {
    async runInsertOne(connectionId, database, collection, doc, rawSql) {
      await runWriteHelper("insertOne", rawSql, async () => {
        const id = await insertDocument(
          connectionId,
          database,
          collection,
          doc,
        );
        return { kind: "insert", insertedIds: [id] };
      });
    },

    async runInsertMany(connectionId, database, collection, docs, rawSql) {
      await runWriteHelper("insertMany", rawSql, async () => {
        const ids = await insertManyDocuments(
          connectionId,
          database,
          collection,
          docs,
        );
        return { kind: "insert", insertedIds: ids };
      });
    },

    async runDeleteMany(connectionId, database, collection, filter, rawSql) {
      await runWriteHelper("deleteMany", rawSql, async () => {
        const deletedCount = await deleteMany(
          connectionId,
          database,
          collection,
          filter,
          true,
        );
        return { kind: "delete", deletedCount };
      });
    },

    async runUpdateMany(
      connectionId,
      database,
      collection,
      filter,
      patch,
      rawSql,
    ) {
      await runWriteHelper("updateMany", rawSql, async () => {
        const modifiedCount = await updateMany(
          connectionId,
          database,
          collection,
          filter,
          patch,
          true,
        );
        return {
          kind: "update",
          matchedCount: modifiedCount,
          modifiedCount,
        };
      });
    },

    async runDeleteOne(connectionId, database, collection, filter, rawSql) {
      await runWriteHelper("deleteOne", rawSql, async () => {
        const idFilter = idOnlyFilter(filter);
        if (idFilter !== null) {
          await deleteDocument(connectionId, database, collection, idFilter);
          return { kind: "delete", deletedCount: 1 };
        }
        const result = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [{ op: "deleteOne", filter }],
          true,
        );
        return { kind: "delete", deletedCount: result.deleted_count };
      });
    },

    async runUpdateOne(
      connectionId,
      database,
      collection,
      filter,
      patch,
      rawSql,
    ) {
      await runWriteHelper("updateOne", rawSql, async () => {
        const idFilter = idOnlyFilter(filter);
        if (idFilter !== null) {
          await updateDocument(
            connectionId,
            database,
            collection,
            idFilter,
            patch,
          );
          return { kind: "update", matchedCount: 1, modifiedCount: 1 };
        }
        const result = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [{ op: "updateOne", filter, update: { $set: patch } }],
          true,
        );
        return {
          kind: "update",
          matchedCount: result.matched_count,
          modifiedCount: result.modified_count,
        };
      });
    },

    async runBulkWrite(connectionId, database, collection, ops, rawSql) {
      await runWriteHelper("bulkWrite", rawSql, async () => {
        const result: BulkWriteResult = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          ops as BulkWriteOp[],
          true,
        );
        return { kind: "bulkWrite", result };
      });
    },

    async runReplaceOne(connectionId, database, collection, op, rawSql) {
      await runWriteHelper("replaceOne", rawSql, async () => {
        const result: BulkWriteResult = await bulkWriteDocuments(
          connectionId,
          database,
          collection,
          [op],
          true,
        );
        return { kind: "bulkWrite", result };
      });
    },

    async runCreateIndex(connectionId, database, collection, request, rawSql) {
      await runMongoIndexHelper("createIndex", rawSql, async () => {
        const result = await createMongoIndex(
          connectionId,
          database,
          collection,
          request,
        );
        return result.name;
      });
    },

    async runDropIndex(connectionId, database, collection, indexName, rawSql) {
      await runMongoIndexHelper("dropIndex", rawSql, async () => {
        await dropMongoIndex(
          connectionId,
          database,
          collection,
          indexName,
          true,
        );
        return indexName;
      });
    },
  };
}
