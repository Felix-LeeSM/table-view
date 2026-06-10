import {
  parseMongoshStatement,
  type MongoshCollectionCommand,
  type MongoshParseError,
} from "@lib/mongo/mongoshAst/index";
import {
  MONGOSH_METHOD_WHITELIST,
  isMongoshMethod,
  type MongoshMethod,
} from "@lib/mongo/mongoshMethods";

export { MONGOSH_METHOD_WHITELIST };
export type { MongoshMethod };

const CURSOR_METHODS: ReadonlySet<MongoshMethod> = new Set([
  "find",
  "aggregate",
]);

const CURSOR_CHAIN_METHODS: ReadonlySet<string> = new Set([
  "sort",
  "limit",
  "skip",
  "toArray",
]);

export type MongoshErrorKind =
  | "unsupported-syntax"
  | "unsupported-method"
  | "bson-literal"
  | "multiple-statements"
  | "missing-db-prefix"
  | "invalid-cursor-chain";

export interface CursorChainStep {
  readonly name: string;
  readonly args: readonly unknown[];
}

export interface ParsedMongoshCall {
  readonly kind: "success";
  readonly collection: string;
  readonly method: MongoshMethod;
  readonly args: readonly unknown[];
  readonly cursorChain: readonly CursorChainStep[];
}

export interface ParsedMongoshError {
  readonly kind: "error";
  readonly errorKind: MongoshErrorKind;
  readonly message: string;
  readonly at?: { readonly line: number; readonly column: number };
}

export function parseMongoshExpression(
  input: string,
): ParsedMongoshCall | ParsedMongoshError {
  if (looksLikeTransactionHelper(input)) {
    return makeError(
      "unsupported-method",
      "Transactions are not supported for mongosh expressions in Table View. Use explicit single-document writes; standalone MongoDB servers do not support multi-document transactions.",
    );
  }

  const parsed = parseMongoshStatement(input);
  if (parsed.kind === "error") return mapParseError(parsed);
  if (parsed.kind !== "collection-command") {
    return makeError(
      "unsupported-syntax",
      "Admin commands are handled by the runCommand dispatcher.",
    );
  }

  if (!isMongoshMethod(parsed.method)) {
    return makeError(
      "unsupported-method",
      `Unsupported method '${parsed.method}'. Supported methods: ${MONGOSH_METHOD_WHITELIST.join(
        ", ",
      )}.`,
    );
  }

  const cursorChain = parsed.cursorChain ?? [];
  const invalidChain = findInvalidCursorChain(parsed.method, cursorChain);
  if (invalidChain) return invalidChain;

  const bsonError = findUnsupportedBsonPlaceholder(parsed);
  if (bsonError) return bsonError;

  return {
    kind: "success",
    collection: parsed.collection,
    method: parsed.method,
    args: parsed.args,
    cursorChain,
  };
}

function looksLikeTransactionHelper(input: string): boolean {
  return /\b(startSession|startTransaction|withTransaction|commitTransaction|abortTransaction)\s*\(/.test(
    input,
  );
}

function findInvalidCursorChain(
  method: MongoshMethod,
  cursorChain: readonly CursorChainStep[],
): ParsedMongoshError | null {
  if (cursorChain.length === 0) return null;
  for (const step of cursorChain) {
    if (!CURSOR_CHAIN_METHODS.has(step.name) || !CURSOR_METHODS.has(method)) {
      return makeError(
        "invalid-cursor-chain",
        `Cursor method '${step.name}' is only supported after find() or aggregate().`,
      );
    }
  }
  return null;
}

function mapParseError(error: MongoshParseError): ParsedMongoshError {
  if (error.errorKind === "multiple-statements") {
    return makeError("multiple-statements", error.message);
  }
  if (error.errorKind === "bson-literal") {
    return makeError("bson-literal", error.message);
  }
  if (error.errorKind === "non-db-statement") {
    return makeError(
      "missing-db-prefix",
      "mongosh expressions must start with `db.`",
    );
  }
  return makeError("unsupported-syntax", error.message);
}

function findUnsupportedBsonPlaceholder(
  parsed: MongoshCollectionCommand,
): ParsedMongoshError | null {
  for (const arg of parsed.args) {
    const error = validateBsonPlaceholder(arg);
    if (error) return error;
  }
  for (const step of parsed.cursorChain ?? []) {
    for (const arg of step.args) {
      const error = validateBsonPlaceholder(arg);
      if (error) return error;
    }
  }
  return null;
}

function validateBsonPlaceholder(value: unknown): ParsedMongoshError | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const error = validateBsonPlaceholder(item);
      if (error) return error;
    }
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const record = value as Record<string, unknown>;
  if ("$oid" in record && !isObjectId(record.$oid)) {
    return makeError(
      "bson-literal",
      "ObjectId(...) expects a 24-character hex string",
    );
  }
  if ("$date" in record && !isIsoDate(record.$date)) {
    return makeError(
      "bson-literal",
      "ISODate(...) expects a valid timestamp string",
    );
  }
  if ("$numberLong" in record && !isInt64String(record.$numberLong)) {
    return makeError(
      "bson-literal",
      "NumberLong(...) expects a 64-bit integer string",
    );
  }
  if ("$numberDecimal" in record && !isDecimalString(record.$numberDecimal)) {
    return makeError(
      "bson-literal",
      "NumberDecimal(...) expects a decimal string",
    );
  }
  if ("$uuid" in record && !isUuidString(record.$uuid)) {
    return makeError("bson-literal", "UUID(...) expects a UUID string");
  }
  if ("$binary" in record && !isBinaryPlaceholder(record.$binary)) {
    return makeError("bson-literal", "BinData(...) payload is malformed");
  }

  for (const item of Object.values(record)) {
    const error = validateBsonPlaceholder(item);
    if (error) return error;
  }
  return null;
}

function isObjectId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-fA-F]{24}$/.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isInt64String(value: unknown): value is string {
  if (typeof value !== "string" || !/^-?[0-9]+$/.test(value)) return false;
  const n = BigInt(value);
  return (
    n >= BigInt("-9223372036854775808") && n <= BigInt("9223372036854775807")
  );
}

function isDecimalString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(value)
  );
}

function isUuidString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$/.test(
      value,
    )
  );
}

function isBinaryPlaceholder(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.base64 === "string" &&
    /^[A-Za-z0-9+/]*=*$/.test(record.base64) &&
    typeof record.subType === "string" &&
    /^[0-9a-fA-F]{2}$/.test(record.subType)
  );
}

function makeError(
  errorKind: MongoshErrorKind,
  message: string,
): ParsedMongoshError {
  return { kind: "error", errorKind, message };
}
