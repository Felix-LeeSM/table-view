import { runMongoCommand } from "@lib/tauri";
import {
  analyzeMongoPipeline,
  analyzeMongoRunCommand,
} from "@lib/mongo/mongoSafety";
import type { SafeModeGate } from "@hooks/useSafeModeGate";
import type { QueryTab } from "@stores/workspaceStore";
import type { DocumentRecordHistoryQueryMode } from "@lib/runtime/history/recordHistoryEntry";
import type { FindBody } from "@/types/document";
import { type QueryResult, type QueryState } from "@/types/query";
import {
  parseMongoshExpression,
  type MongoWriteDispatchers,
  type MongoWriteRunnerRef,
  type ParsedMongoshCall,
} from "@features/query";
import {
  classifyMongoStatement,
  extractAdminCommandBody,
} from "@lib/mongo/runCommandParser";
import {
  applyAggregateCursorChain,
  applyFindCursorChain,
  isRecord,
} from "./queryHelpers";
import {
  runDocumentCount,
  runDocumentDistinct,
  runDocumentEstimatedCount,
  runDocumentFind,
  runDocumentFindOne,
} from "./mongoDocumentResults";
import { dispatchMongoWriteCall } from "./mongoWriteDispatch";

type MongoHistoryStatus = "success" | "error" | "cancelled";

export interface MongoHistoryPayload {
  sql: string;
  executedAt: number;
  duration: number;
  status: MongoHistoryStatus;
  queryMode?: DocumentRecordHistoryQueryMode;
}

export interface MongoPendingConfirm {
  pipeline: Record<string, unknown>[];
  reason: string;
  previewLines?: string[];
}

export interface MongoPendingWarn {
  pipeline: Record<string, unknown>[];
  previewLines?: string[];
}

export type MongoTabContext = Pick<
  QueryTab,
  "id" | "connectionId" | "database" | "collection" | "paradigm" | "sql"
>;

export interface MongoLifecycleActions {
  updateQueryState: (tabId: string, state: QueryState) => void;
  completeQuery: (tabId: string, queryId: string, result: QueryResult) => void;
  failQuery: (tabId: string, queryId: string, errorMessage: string) => void;
  recordHistory: (payload: MongoHistoryPayload) => void;
}

interface MongoGateActions {
  decideSafeMode: SafeModeGate["decide"];
  setPendingMongoConfirm: (pending: MongoPendingConfirm) => void;
  setPendingMongoWarn: (pending: MongoPendingWarn) => void;
  pendingWriteRunnerRef: MongoWriteRunnerRef;
}

export interface ExecuteMongoAggregateRequest extends MongoLifecycleActions {
  tab: MongoTabContext;
  pipeline: Record<string, unknown>[];
  collectionOverride?: string;
}

export interface ExecuteMongoQueryRequest
  extends MongoLifecycleActions, MongoGateActions, MongoWriteDispatchers {
  tab: MongoTabContext;
  sql: string;
  runMongoAggregate: (
    pipeline: Record<string, unknown>[],
    collectionOverride?: string,
  ) => Promise<void>;
}

async function executeMongoRunCommandIfPresent(
  request: ExecuteMongoQueryRequest,
): Promise<boolean> {
  const {
    tab,
    sql,
    decideSafeMode,
    updateQueryState,
    completeQuery,
    failQuery,
    recordHistory,
    setPendingMongoConfirm,
    pendingWriteRunnerRef,
  } = request;

  const statementKind = classifyMongoStatement(sql);
  if (statementKind !== "admin-command") return false;

  const body = extractAdminCommandBody(sql);
  if (!body) {
    updateQueryState(tab.id, {
      status: "error",
      error:
        'Failed to parse the runCommand body — expected a JSON-shaped object like `{ ping: 1 }`. BSON literals (`ObjectId("…")`, `ISODate("…")`, `NumberLong("…")`, `Decimal128("…")`, `UUID("…")`) are accepted; nested calls or unknown literals are not.',
    });
    return true;
  }

  const isAdminCommand = /^\s*db\.adminCommand\s*\(/.test(sql);
  const dbArg: string | null = isAdminCommand
    ? null
    : tab.database && tab.database.length > 0
      ? tab.database
      : null;
  const adminAnalysis = analyzeMongoRunCommand(body);
  const adminDecision = decideSafeMode(adminAnalysis);
  if (adminDecision.action === "block") {
    updateQueryState(tab.id, {
      status: "error",
      error: adminDecision.reason,
    });
    return true;
  }

  const adminRequiresConfirmation = adminAnalysis.severity !== "info";
  const adminConfirmReason =
    adminDecision.action === "confirm"
      ? adminDecision.reason
      : (adminAnalysis.reasons[0] ??
        "MongoDB runCommand requires confirmation");
  const queryId = `${tab.id}-${Date.now()}`;
  const startTime = Date.now();
  const adminRunner = async () => {
    updateQueryState(tab.id, { status: "running", queryId });
    try {
      const response = await runMongoCommand(
        tab.connectionId,
        dbArg,
        body,
        adminAnalysis.severity !== "info",
        queryId,
      );
      const responseJson = JSON.stringify(response, null, 2);
      const queryResult: QueryResult = {
        columns: [
          {
            name: "response",
            dataType: "JSON",
            category: "object",
          },
        ],
        rows: [[responseJson]],
        totalCount: 1,
        executionTimeMs: Date.now() - startTime,
        queryType: "select",
      };
      completeQuery(tab.id, queryId, queryResult);
      recordHistory({
        sql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "success",
      });
    } catch (err) {
      failQuery(
        tab.id,
        queryId,
        err instanceof Error ? err.message : String(err),
      );
      recordHistory({
        sql,
        executedAt: Date.now(),
        duration: Date.now() - startTime,
        status: "error",
      });
    }
  };

  if (adminDecision.action === "confirm" || adminRequiresConfirmation) {
    pendingWriteRunnerRef.current = adminRunner;
    setPendingMongoConfirm({
      pipeline: [],
      reason: adminConfirmReason,
      previewLines: [sql],
    });
    return true;
  }
  await adminRunner();
  return true;
}

async function dispatchMongoshCall(
  request: ExecuteMongoQueryRequest,
  parsed: ParsedMongoshCall,
  ctx: {
    connectionId: string;
    database: string;
    collection: string;
    rawSql: string;
  },
): Promise<void> {
  const {
    tab,
    decideSafeMode,
    updateQueryState,
    setPendingMongoConfirm,
    setPendingMongoWarn,
    runMongoAggregate,
  } = request;
  const { connectionId, database, collection, rawSql } = ctx;

  if (parsed.method === "aggregate") {
    const pipelineRaw = parsed.args[0];
    if (parsed.args.length > 1) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "aggregate() options are not supported. Use pipeline stages for sort, skip, and limit.",
      });
      return;
    }
    if (!Array.isArray(pipelineRaw)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "Pipeline must be an array of stage objects.",
      });
      return;
    }
    const pipeline = pipelineRaw.filter(isRecord) as Record<string, unknown>[];
    if (pipeline.length !== pipelineRaw.length) {
      updateQueryState(tab.id, {
        status: "error",
        error: "Pipeline must be an array of stage objects.",
      });
      return;
    }
    const cursorPipeline = applyAggregateCursorChain(
      pipeline,
      parsed.cursorChain,
    );
    if (!cursorPipeline.ok) {
      updateQueryState(tab.id, {
        status: "error",
        error: cursorPipeline.error,
      });
      return;
    }
    const pipelineWithCursor = cursorPipeline.value;
    const analysis = analyzeMongoPipeline(pipelineWithCursor);
    const decision = decideSafeMode(analysis);
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return;
    }
    if (decision.action === "confirm") {
      setPendingMongoConfirm({
        pipeline: pipelineWithCursor,
        reason: decision.reason,
      });
      return;
    }
    if (analysis.severity === "warn") {
      setPendingMongoWarn({ pipeline: pipelineWithCursor });
      return;
    }
    await runMongoAggregate(pipelineWithCursor, collection);
    return;
  }

  if (parsed.method === "find") {
    const filterArg = parsed.args[0];
    const projectionArg = parsed.args[1];
    const body: FindBody = {};
    if (parsed.args.length > 2) {
      updateQueryState(tab.id, {
        status: "error",
        error: "find() accepts at most filter and projection arguments.",
      });
      return;
    }
    if (isRecord(filterArg)) {
      body.filter = filterArg;
    } else if (filterArg !== undefined) {
      updateQueryState(tab.id, {
        status: "error",
        error: "find() filter must be an object.",
      });
      return;
    }
    if (isRecord(projectionArg)) {
      body.projection = projectionArg;
    } else if (projectionArg !== undefined) {
      updateQueryState(tab.id, {
        status: "error",
        error: "find() projection must be an object.",
      });
      return;
    }
    const cursorBody = applyFindCursorChain(body, parsed.cursorChain);
    if (!cursorBody.ok) {
      updateQueryState(tab.id, {
        status: "error",
        error: cursorBody.error,
      });
      return;
    }
    await runDocumentFind(
      request,
      tab,
      connectionId,
      database,
      collection,
      cursorBody.value,
      rawSql,
    );
    return;
  }

  if (parsed.method === "findOne") {
    const filterArg = parsed.args[0];
    if (filterArg !== undefined && !isRecord(filterArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "findOne() filter must be an object.",
      });
      return;
    }
    await runDocumentFindOne(
      request,
      tab,
      connectionId,
      database,
      collection,
      filterArg as Record<string, unknown> | undefined,
      rawSql,
    );
    return;
  }

  if (parsed.method === "countDocuments") {
    const filterArg = parsed.args[0];
    if (filterArg !== undefined && !isRecord(filterArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "countDocuments() filter must be an object.",
      });
      return;
    }
    await runDocumentCount(
      request,
      tab,
      connectionId,
      database,
      collection,
      filterArg as Record<string, unknown> | undefined,
      rawSql,
    );
    return;
  }

  if (parsed.method === "estimatedDocumentCount") {
    await runDocumentEstimatedCount(
      request,
      tab,
      connectionId,
      database,
      collection,
      rawSql,
    );
    return;
  }

  if (parsed.method === "distinct") {
    const fieldArg = parsed.args[0];
    if (typeof fieldArg !== "string") {
      updateQueryState(tab.id, {
        status: "error",
        error: "distinct() requires a string field name as the first argument.",
      });
      return;
    }
    const filterArg = parsed.args[1];
    if (filterArg !== undefined && !isRecord(filterArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "distinct() filter must be an object.",
      });
      return;
    }
    await runDocumentDistinct(
      request,
      tab,
      connectionId,
      database,
      collection,
      fieldArg,
      filterArg as Record<string, unknown> | undefined,
      rawSql,
    );
    return;
  }

  if (await dispatchMongoWriteCall(request, parsed, ctx)) {
    return;
  }

  updateQueryState(tab.id, {
    status: "error",
    error: `Method '${parsed.method}' is not yet wired.`,
  });
}

export async function executeMongoQuery(
  request: ExecuteMongoQueryRequest,
): Promise<void> {
  const { tab, sql, updateQueryState } = request;

  if (await executeMongoRunCommandIfPresent(request)) {
    return;
  }

  if (!tab.database) {
    updateQueryState(tab.id, {
      status: "error",
      error:
        "Select a target database from the toolbar chip, then type a mongosh expression (e.g. `db.users.find({})`). Admin commands like `db.runCommand({ping: 1})` run without one.",
    });
    return;
  }

  const parsed = parseMongoshExpression(sql);
  if (parsed.kind === "error") {
    updateQueryState(tab.id, {
      status: "error",
      error: parsed.message,
    });
    return;
  }

  if (tab.collection && tab.collection !== parsed.collection) {
    updateQueryState(tab.id, {
      status: "error",
      error: `Editor targets collection '${parsed.collection}' but tab is bound to '${tab.collection}'.`,
    });
    return;
  }
  const targetCollection = tab.collection ?? parsed.collection;

  await dispatchMongoshCall(request, parsed, {
    connectionId: tab.connectionId,
    database: tab.database,
    collection: targetCollection,
    rawSql: sql,
  });
}
