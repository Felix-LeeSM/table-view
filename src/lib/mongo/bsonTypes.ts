/**
 * Canonical EJSON BSON wrapper helpers.
 *
 * Used by:
 * - `BsonTypeEditor`, which validates and packages the user's raw string
 *   type-aware.
 * - The commit path of F.2 nested edits / top-level cell edits, which keeps
 *   the wrapper intact on its way to mqlGenerator.
 *
 * Invariants:
 * - Recognizes only the canonical EJSON shape. A multi-key object such as
 *   `{ $oid: x, extra: y }` is treated as a plain object (not a BSON
 *   wrapper).
 * - Preserves representation precision — Decimal128 stays a string (no
 *   float casting).
 */

export type BsonType = "objectId" | "date" | "decimal128" | "binData";

/** ObjectId — 24 hex chars, lowercase or uppercase (Mongo's canonical form
 *  is lowercase, but uppercase user input is common). */
const OID_REGEX = /^[0-9a-fA-F]{24}$/;
/** Base64 strict — allows `=` padding. 1 to several thousand chars long. */
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
/** Decimal — user-typed numeric string. Sign, decimal point, exponent OK. */
const DECIMAL_REGEX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** The wrapper type for a canonical EJSON wrapper, otherwise null. A
 *  multi-key object is not a wrapper, so it yields null. */
export function detectBsonType(value: unknown): BsonType | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  switch (keys[0]) {
    case "$oid":
      return "objectId";
    case "$date":
      return "date";
    case "$numberDecimal":
      return "decimal128";
    case "$binary":
      return "binData";
    default:
      return null;
  }
}

export type CoerceResult =
  | { value: Record<string, unknown> }
  | { error: string };

/** Raw user input → canonical EJSON object, or a validation error message. */
export function coerceToEjson(type: BsonType, rawInput: string): CoerceResult {
  switch (type) {
    case "objectId":
      if (!OID_REGEX.test(rawInput)) {
        return { error: "ObjectId must be a 24-hex string" };
      }
      return { value: { $oid: rawInput } };

    case "date": {
      if (rawInput.trim() === "") {
        return { error: "Date is empty (need ISO 8601)" };
      }
      const ms = Date.parse(rawInput);
      if (Number.isNaN(ms)) {
        return { error: "Date must be ISO 8601 (e.g. 2026-05-15T12:00:00Z)" };
      }
      return { value: { $date: new Date(ms).toISOString() } };
    }

    case "decimal128":
      if (rawInput.trim() === "") {
        return { error: "Decimal128 cannot be empty" };
      }
      if (!DECIMAL_REGEX.test(rawInput.trim())) {
        return { error: "Decimal128 must be a numeric string" };
      }
      return { value: { $numberDecimal: rawInput.trim() } };

    case "binData":
      if (!BASE64_REGEX.test(rawInput)) {
        return { error: "BinData payload must be base64" };
      }
      return {
        value: { $binary: { base64: rawInput, subType: "00" } },
      };
  }
}

/** Canonical EJSON wrapper → raw string for the user to edit. Returns a
 *  best-effort value even on a detect mismatch (validation is the caller's
 *  job). */
export function ejsonToEditableString(type: BsonType, value: unknown): string {
  if (!isPlainRecord(value)) return "";
  switch (type) {
    case "objectId": {
      const v = value.$oid;
      return typeof v === "string" ? v : "";
    }
    case "date": {
      const v = value.$date;
      if (typeof v === "string") return v;
      // canonical EJSON v2 numberLong shape
      if (isPlainRecord(v) && typeof v.$numberLong === "string") {
        const ms = Number.parseInt(v.$numberLong as string, 10);
        if (Number.isInteger(ms)) return new Date(ms).toISOString();
      }
      return "";
    }
    case "decimal128": {
      const v = value.$numberDecimal;
      return typeof v === "string" ? v : "";
    }
    case "binData": {
      const v = value.$binary;
      if (isPlainRecord(v) && typeof v.base64 === "string") {
        return v.base64 as string;
      }
      return "";
    }
  }
}
