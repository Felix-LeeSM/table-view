import { analyzeMongoOperation } from "@lib/mongo/mongoSafety";
import { idOnlyFilter } from "@lib/mongo/documentIdentity";
import type { ParsedMongoshCall } from "@features/query";
import type { BulkWriteOp } from "@/types/documentMutate";
import {
  buildCreateMongoIndexRequest,
  extractDollarSet,
  isRecord,
  parseReplaceOneOptions,
} from "./queryHelpers";
import type { ExecuteMongoQueryRequest } from "./mongoQueryExecution";

const BULK_WRITE_OP_NAMES = [
  "insertOne",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "replaceOne",
] as const satisfies readonly BulkWriteOp["op"][];

type NormalizeBulkWriteOpsResult =
  | { ok: true; ops: BulkWriteOp[] }
  | { ok: false; error: string };

type NormalizeBulkWriteOpResult =
  | { ok: true; op: BulkWriteOp }
  | { ok: false; error: string };

function isBulkWriteOpName(value: string): value is BulkWriteOp["op"] {
  return (BULK_WRITE_OP_NAMES as readonly string[]).includes(value);
}

function readBulkWriteRecordField(
  record: Record<string, unknown>,
  field: string,
  label: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value = record[field];
  if (!isRecord(value)) {
    return { ok: false, error: `bulkWrite ${label} must be an object.` };
  }
  return { ok: true, value };
}

function readOptionalBulkWriteBoolean(
  record: Record<string, unknown>,
  field: string,
  label: string,
): { ok: true; value?: boolean } | { ok: false; error: string } {
  const value = record[field];
  if (value === undefined) return { ok: true };
  if (typeof value !== "boolean") {
    return { ok: false, error: `bulkWrite ${label} must be a boolean.` };
  }
  return { ok: true, value };
}

function normalizeBulkWriteSpec(
  op: BulkWriteOp["op"],
  spec: Record<string, unknown>,
): NormalizeBulkWriteOpResult {
  if (op === "insertOne") {
    const document = readBulkWriteRecordField(
      spec,
      "document",
      "insertOne.document",
    );
    if (!document.ok) return document;
    return { ok: true, op: { op, document: document.value } };
  }

  if (op === "deleteOne" || op === "deleteMany") {
    const filter = readBulkWriteRecordField(spec, "filter", `${op}.filter`);
    if (!filter.ok) return filter;
    return { ok: true, op: { op, filter: filter.value } };
  }

  if (op === "replaceOne") {
    const filter = readBulkWriteRecordField(
      spec,
      "filter",
      "replaceOne.filter",
    );
    if (!filter.ok) return filter;
    const replacement = readBulkWriteRecordField(
      spec,
      "replacement",
      "replaceOne.replacement",
    );
    if (!replacement.ok) return replacement;
    const upsert = readOptionalBulkWriteBoolean(
      spec,
      "upsert",
      "replaceOne.upsert",
    );
    if (!upsert.ok) return upsert;
    const normalized: Extract<BulkWriteOp, { op: "replaceOne" }> = {
      op,
      filter: filter.value,
      replacement: replacement.value,
    };
    if (upsert.value !== undefined) normalized.upsert = upsert.value;
    return { ok: true, op: normalized };
  }

  const filter = readBulkWriteRecordField(spec, "filter", `${op}.filter`);
  if (!filter.ok) return filter;
  const update = readBulkWriteRecordField(spec, "update", `${op}.update`);
  if (!update.ok) return update;
  const upsert = readOptionalBulkWriteBoolean(spec, "upsert", `${op}.upsert`);
  if (!upsert.ok) return upsert;
  const normalized: Extract<BulkWriteOp, { op: "updateOne" | "updateMany" }> = {
    op,
    filter: filter.value,
    update: update.value,
  };
  if (upsert.value !== undefined) normalized.upsert = upsert.value;
  return { ok: true, op: normalized };
}

function normalizeBulkWriteOperation(
  raw: unknown,
  index: number,
): NormalizeBulkWriteOpResult {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: `bulkWrite operation ${index} must be an object.`,
    };
  }

  const internalOp = raw["op"];
  if (typeof internalOp === "string") {
    if (!isBulkWriteOpName(internalOp)) {
      return {
        ok: false,
        error: `unsupported bulkWrite operation: ${internalOp}`,
      };
    }
    return normalizeBulkWriteSpec(internalOp, raw);
  }

  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    return {
      ok: false,
      error: `bulkWrite operation ${index} must contain exactly one operation name.`,
    };
  }
  const op = keys[0]!;
  if (!isBulkWriteOpName(op)) {
    return { ok: false, error: `unsupported bulkWrite operation: ${op}` };
  }
  const spec = raw[op];
  if (!isRecord(spec)) {
    return { ok: false, error: `bulkWrite ${op} must be an object.` };
  }
  return normalizeBulkWriteSpec(op, spec);
}

function normalizeBulkWriteOperations(
  rawOps: readonly unknown[],
): NormalizeBulkWriteOpsResult {
  const ops: BulkWriteOp[] = [];
  for (const [index, raw] of rawOps.entries()) {
    const normalized = normalizeBulkWriteOperation(raw, index);
    if (!normalized.ok) return normalized;
    ops.push(normalized.op);
  }
  return { ok: true, ops };
}

function findNonDeterministicBulkWriteOp(
  ops: readonly BulkWriteOp[],
): string | null {
  for (const op of ops) {
    if (
      (op.op === "updateOne" ||
        op.op === "deleteOne" ||
        op.op === "replaceOne") &&
      idOnlyFilter(op.filter) === null
    ) {
      return `${op.op} in bulkWrite() requires an _id-only filter for deterministic document identity.`;
    }
  }
  return null;
}

export async function dispatchMongoWriteCall(
  request: ExecuteMongoQueryRequest,
  parsed: ParsedMongoshCall,
  ctx: {
    connectionId: string;
    database: string;
    collection: string;
    rawSql: string;
  },
): Promise<boolean> {
  const {
    tab,
    decideSafeMode,
    updateQueryState,
    setPendingMongoConfirm,
    setPendingMongoWarn,
    pendingWriteRunnerRef,
  } = request;
  const { connectionId, database, collection, rawSql } = ctx;

  if (parsed.method === "insertOne") {
    const doc = parsed.args[0];
    if (!isRecord(doc)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "insertOne() requires a document object.",
      });
      return true;
    }
    await request.runInsertOne(connectionId, database, collection, doc, rawSql);
    return true;
  }

  if (parsed.method === "insertMany") {
    const docs = parsed.args[0];
    if (!Array.isArray(docs) || !docs.every(isRecord)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "insertMany() requires an array of documents.",
      });
      return true;
    }
    await request.runInsertMany(
      connectionId,
      database,
      collection,
      docs as Record<string, unknown>[],
      rawSql,
    );
    return true;
  }

  if (parsed.method === "deleteMany") {
    const filterArg = parsed.args[0];
    const filter = isRecord(filterArg) ? filterArg : {};
    if (filterArg !== undefined && !isRecord(filterArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "deleteMany() filter must be an object.",
      });
      return true;
    }
    const analysis = analyzeMongoOperation({ kind: "deleteMany", filter });
    const decision = decideSafeMode(analysis);
    const runner = () =>
      request.runDeleteMany(connectionId, database, collection, filter, rawSql);
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return true;
    }
    if (decision.action === "confirm") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoConfirm({
        pipeline: [],
        reason: decision.reason,
        previewLines: [rawSql],
      });
      return true;
    }
    if (analysis.severity === "warn") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
      return true;
    }
    await runner();
    return true;
  }

  if (parsed.method === "updateMany") {
    const filterArg = parsed.args[0];
    const updateArg = parsed.args[1];
    if (!isRecord(filterArg) || !isRecord(updateArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "updateMany() requires a filter object and an update object.",
      });
      return true;
    }
    const patch = extractDollarSet(updateArg);
    if (patch === null) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "updateMany() update document must use `$set` with a non-_id patch.",
      });
      return true;
    }
    const analysis = analyzeMongoOperation({
      kind: "updateMany",
      filter: filterArg,
      patch,
    });
    const decision = decideSafeMode(analysis);
    const runner = () =>
      request.runUpdateMany(
        connectionId,
        database,
        collection,
        filterArg,
        patch,
        rawSql,
      );
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return true;
    }
    if (decision.action === "confirm") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoConfirm({
        pipeline: [],
        reason: decision.reason,
        previewLines: [rawSql],
      });
      return true;
    }
    if (analysis.severity === "warn") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
      return true;
    }
    await runner();
    return true;
  }

  if (parsed.method === "deleteOne") {
    const filterArg = parsed.args[0];
    if (!isRecord(filterArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "deleteOne() filter must be an object.",
      });
      return true;
    }
    if (idOnlyFilter(filterArg) === null) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "deleteOne() requires an _id-only filter for deterministic document identity.",
      });
      return true;
    }
    await request.runDeleteOne(
      connectionId,
      database,
      collection,
      filterArg,
      rawSql,
    );
    return true;
  }

  if (parsed.method === "updateOne") {
    const filterArg = parsed.args[0];
    const updateArg = parsed.args[1];
    if (!isRecord(filterArg) || !isRecord(updateArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "updateOne() requires a filter object and an update object.",
      });
      return true;
    }
    const patch = extractDollarSet(updateArg);
    if (patch === null) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "updateOne() update document must use `$set` with a non-_id patch.",
      });
      return true;
    }
    if (idOnlyFilter(filterArg) === null) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "updateOne() requires an _id-only filter for deterministic document identity.",
      });
      return true;
    }
    await request.runUpdateOne(
      connectionId,
      database,
      collection,
      filterArg,
      patch,
      rawSql,
    );
    return true;
  }

  if (parsed.method === "replaceOne") {
    const filterArg = parsed.args[0];
    const replacementArg = parsed.args[1];
    if (!isRecord(filterArg) || !isRecord(replacementArg)) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "replaceOne() requires a filter object and a replacement object.",
      });
      return true;
    }
    if (Object.keys(replacementArg).some((key) => key.startsWith("$"))) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "replaceOne() replacement must be a document, not an update document.",
      });
      return true;
    }
    if (idOnlyFilter(filterArg) === null) {
      updateQueryState(tab.id, {
        status: "error",
        error:
          "replaceOne() requires an _id-only filter for deterministic document identity.",
      });
      return true;
    }
    const options = parseReplaceOneOptions(parsed.args[2]);
    if (!options.ok) {
      updateQueryState(tab.id, {
        status: "error",
        error: options.error,
      });
      return true;
    }
    const op: BulkWriteOp = {
      op: "replaceOne",
      filter: filterArg,
      replacement: replacementArg,
    };
    if (options.upsert !== undefined) op.upsert = options.upsert;
    const analysis = analyzeMongoOperation({
      kind: "bulkWrite",
      ops: [op],
    });
    const decision = decideSafeMode(analysis);
    const runner = () =>
      request.runReplaceOne(connectionId, database, collection, op, rawSql);
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return true;
    }
    if (decision.action === "confirm") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoConfirm({
        pipeline: [],
        reason: decision.reason,
        previewLines: [rawSql],
      });
      return true;
    }
    if (analysis.severity === "warn") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
      return true;
    }
    await runner();
    return true;
  }

  if (parsed.method === "bulkWrite") {
    const opsRaw = parsed.args[0];
    if (!Array.isArray(opsRaw)) {
      updateQueryState(tab.id, {
        status: "error",
        error: "bulkWrite() requires an array of operations.",
      });
      return true;
    }
    const normalized = normalizeBulkWriteOperations(opsRaw);
    if (!normalized.ok) {
      updateQueryState(tab.id, {
        status: "error",
        error: normalized.error,
      });
      return true;
    }
    const ops = normalized.ops;
    const identityError = findNonDeterministicBulkWriteOp(ops);
    if (identityError !== null) {
      updateQueryState(tab.id, {
        status: "error",
        error: identityError,
      });
      return true;
    }
    const analysis = analyzeMongoOperation({ kind: "bulkWrite", ops });
    const decision = decideSafeMode(analysis);
    const runner = () =>
      request.runBulkWrite(connectionId, database, collection, ops, rawSql);
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return true;
    }
    if (decision.action === "confirm") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoConfirm({
        pipeline: [],
        reason: decision.reason,
        previewLines: [rawSql],
      });
      return true;
    }
    if (analysis.severity === "warn") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoWarn({ pipeline: [], previewLines: [rawSql] });
      return true;
    }
    await runner();
    return true;
  }

  if (parsed.method === "createIndex") {
    const requestResult = buildCreateMongoIndexRequest(
      parsed.args[0],
      parsed.args[1],
    );
    if (!requestResult.ok) {
      updateQueryState(tab.id, {
        status: "error",
        error: requestResult.error,
      });
      return true;
    }
    await request.runCreateIndex(
      connectionId,
      database,
      collection,
      requestResult.request,
      rawSql,
    );
    return true;
  }

  if (parsed.method === "dropIndex") {
    const nameArg = parsed.args[0];
    if (typeof nameArg !== "string" || nameArg.trim().length === 0) {
      updateQueryState(tab.id, {
        status: "error",
        error: "dropIndex() requires a non-empty index name string.",
      });
      return true;
    }
    const indexName = nameArg.trim();
    const analysis = {
      kind: "mongo-drop" as const,
      severity: "danger" as const,
      reasons: ["MongoDB dropIndex (index removal)"],
    };
    const decision = decideSafeMode(analysis);
    const runner = () =>
      request.runDropIndex(
        connectionId,
        database,
        collection,
        indexName,
        rawSql,
      );
    if (decision.action === "block") {
      updateQueryState(tab.id, {
        status: "error",
        error: decision.reason,
      });
      return true;
    }
    if (decision.action === "confirm") {
      pendingWriteRunnerRef.current = runner;
      setPendingMongoConfirm({
        pipeline: [],
        reason: decision.reason,
        previewLines: [rawSql],
      });
      return true;
    }
    await runner();
    return true;
  }

  return false;
}
