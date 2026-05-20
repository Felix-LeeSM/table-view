import type { ConnectionConfig, ConnectionStatus } from "@/types/connection";
import type {
  DocumentColumn,
  DocumentQueryResult,
  DocumentRow,
} from "@/types/document";
import type { BulkWriteResult, DocumentId } from "@/types/documentMutate";
import type {
  QueryColumn,
  QueryResult,
  QueryState,
  QueryStatementResult,
  QueryType,
  WriteSummaryData,
} from "@/types/query";

type LooseRecord = Record<string, unknown>;

function isRecord(value: unknown): value is LooseRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): LooseRecord {
  return isRecord(value) ? value : {};
}

function pick(r: LooseRecord, camel: string, snake: string): unknown {
  return r[camel] ?? r[snake];
}

function stringOr(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function optionalBool(value: unknown): boolean | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "boolean" ? value : null;
}

function rowsOrEmpty(value: unknown): unknown[][] {
  return Array.isArray(value) ? (value as unknown[][]) : [];
}

export function normalizeQueryColumn(value: unknown): QueryColumn {
  const r = record(value);
  return {
    name: stringOr(r.name),
    dataType: stringOr(pick(r, "dataType", "data_type")),
    category: (r.category ?? "unknown") as QueryColumn["category"],
  };
}

export function normalizeDocumentColumn(value: unknown): DocumentColumn {
  const r = record(value);
  return {
    name: stringOr(r.name),
    dataType: stringOr(pick(r, "dataType", "data_type")),
    category: (r.category ?? "unknown") as DocumentColumn["category"],
  };
}

export function normalizeDocumentId(value: unknown): DocumentId {
  const r = record(value);
  if (typeof r.objectId === "string") return { objectId: r.objectId };
  if (typeof r.ObjectId === "string") return { objectId: r.ObjectId };
  if (typeof r.string === "string") return { string: r.string };
  if (typeof r.String === "string") return { string: r.String };
  if (typeof r.number === "number") return { number: r.number };
  if (typeof r.Number === "number") return { number: r.Number };
  if ("raw" in r) return { raw: r.raw };
  return { raw: r.Raw };
}

export function normalizeBulkWriteResult(value: unknown): BulkWriteResult {
  const r = record(value);
  return {
    inserted_count: numberOr(r.inserted_count),
    matched_count: numberOr(r.matched_count),
    modified_count: numberOr(r.modified_count),
    deleted_count: numberOr(r.deleted_count),
    upserted_ids: Array.isArray(r.upserted_ids)
      ? r.upserted_ids.map(normalizeDocumentId)
      : [],
  };
}

export function normalizeWriteSummary(value: unknown): WriteSummaryData {
  const r = record(value);
  switch (r.kind) {
    case "insert":
      return {
        kind: "insert",
        insertedIds: Array.isArray(r.insertedIds)
          ? r.insertedIds.map(normalizeDocumentId)
          : [],
      };
    case "update":
      return {
        kind: "update",
        matchedCount: numberOr(r.matchedCount),
        modifiedCount: numberOr(r.modifiedCount),
      };
    case "delete":
      return { kind: "delete", deletedCount: numberOr(r.deletedCount) };
    case "bulkWrite":
      return { kind: "bulkWrite", result: normalizeBulkWriteResult(r.result) };
    default:
      return { kind: "insert", insertedIds: [] };
  }
}

export function normalizeQueryResult(value: unknown): QueryResult {
  const r = record(value);
  const result: QueryResult = {
    columns: Array.isArray(r.columns)
      ? r.columns.map(normalizeQueryColumn)
      : [],
    rows: rowsOrEmpty(r.rows),
    totalCount: numberOr(pick(r, "totalCount", "total_count")),
    executionTimeMs: numberOr(pick(r, "executionTimeMs", "execution_time_ms")),
    queryType: (pick(r, "queryType", "query_type") ?? "select") as QueryType,
  };
  if (
    r.resultKind === "grid" ||
    r.resultKind === "scalar" ||
    r.resultKind === "list" ||
    r.resultKind === "writeSummary"
  ) {
    result.resultKind = r.resultKind;
  }
  if (r.writeSummary) {
    result.writeSummary = normalizeWriteSummary(r.writeSummary);
  }
  return result;
}

export function normalizeDocumentQueryResult(
  value: unknown,
): DocumentQueryResult {
  const r = record(value);
  return {
    columns: Array.isArray(r.columns)
      ? r.columns.map(normalizeDocumentColumn)
      : [],
    rows: rowsOrEmpty(r.rows),
    rawDocuments: Array.isArray(pick(r, "rawDocuments", "raw_documents"))
      ? (pick(r, "rawDocuments", "raw_documents") as Record<string, unknown>[])
      : [],
    totalCount: numberOr(pick(r, "totalCount", "total_count")),
    executionTimeMs: numberOr(pick(r, "executionTimeMs", "execution_time_ms")),
  };
}

export function normalizeDocumentRow(value: unknown): DocumentRow {
  const r = record(value);
  return {
    columns: Array.isArray(r.columns)
      ? r.columns.map(normalizeDocumentColumn)
      : [],
    row: Array.isArray(r.row) ? r.row : [],
    raw: record(r.raw),
  };
}

function normalizeQueryStatementResult(value: unknown): QueryStatementResult {
  const r = record(value);
  return {
    sql: stringOr(r.sql),
    status: r.status === "error" ? "error" : "success",
    result: r.result ? normalizeQueryResult(r.result) : undefined,
    error: typeof r.error === "string" ? r.error : undefined,
    durationMs: numberOr(r.durationMs),
  };
}

export function normalizeQueryState(value: unknown): QueryState {
  const r = record(value);
  if (r.status === "running" && typeof r.queryId === "string") {
    return { status: "running", queryId: r.queryId };
  }
  if (r.status === "completed" && r.result) {
    return {
      status: "completed",
      result: normalizeQueryResult(r.result),
      statements: Array.isArray(r.statements)
        ? r.statements.map(normalizeQueryStatementResult)
        : undefined,
      isDryRun: r.isDryRun === true,
    };
  }
  if (r.status === "error" && typeof r.error === "string") {
    return { status: "error", error: r.error };
  }
  return { status: "idle" };
}

export function normalizeConnectionConfig(value: unknown): ConnectionConfig {
  const r = record(value);
  const dbType = stringOr(pick(r, "dbType", "db_type"), "postgresql");
  return {
    id: stringOr(r.id),
    name: stringOr(r.name),
    dbType: dbType as ConnectionConfig["dbType"],
    host: stringOr(r.host),
    port: numberOr(r.port),
    user: stringOr(r.user),
    database: stringOr(r.database),
    groupId: nullableString(pick(r, "groupId", "group_id")),
    color: nullableString(r.color),
    connectionTimeout: optionalNumber(
      pick(r, "connectionTimeout", "connection_timeout"),
    ),
    keepAliveInterval: optionalNumber(
      pick(r, "keepAliveInterval", "keep_alive_interval"),
    ),
    environment: optionalString(r.environment),
    hasPassword: r.hasPassword === true || r.has_password === true,
    paradigm:
      r.paradigm === "document" ||
      r.paradigm === "search" ||
      r.paradigm === "kv"
        ? r.paradigm
        : "rdb",
    authSource: optionalString(pick(r, "authSource", "auth_source")),
    replicaSet: optionalString(pick(r, "replicaSet", "replica_set")),
    tlsEnabled: optionalBool(pick(r, "tlsEnabled", "tls_enabled")),
  };
}

export function normalizeConnectionStatus(value: unknown): ConnectionStatus {
  const r = record(value);
  if (r.type === "connected") {
    const activeDb = stringOr(pick(r, "activeDb", "active_db"), "");
    return activeDb ? { type: "connected", activeDb } : { type: "connected" };
  }
  if (r.type === "connecting") return { type: "connecting" };
  if (r.type === "error")
    return { type: "error", message: stringOr(r.message) };
  return { type: "disconnected" };
}

export function normalizeActiveStatuses(
  value: unknown,
): Record<string, ConnectionStatus> {
  const r = record(value);
  const out: Record<string, ConnectionStatus> = {};
  for (const [id, status] of Object.entries(r)) {
    out[id] = normalizeConnectionStatus(status);
  }
  return out;
}
