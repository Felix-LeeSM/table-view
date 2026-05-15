/**
 * Sprint 323 — Slice G.1: canonical EJSON BSON wrapper helpers.
 *
 * 사용처:
 * - `BsonTypeEditor` 가 사용자 raw-string 을 type-aware 로 검증/패키징.
 * - F.2 nested edit / top-level cell edit 의 commit path 가 wrapper 를
 *   유지한 채 mqlGenerator 로 흘려보낸다 (Sprint 324, G.2 wire-up).
 *
 * Invariants:
 * - canonical EJSON shape 만 인식. `{ $oid: x, extra: y }` 같은 multi-key
 *   object 는 plain object 로 취급 (BSON wrapper 가 아님).
 * - 표현 precision 보존 — Decimal128 은 string 유지 (float 캐스팅 금지).
 */

export type BsonType = "objectId" | "date" | "decimal128" | "binData";

/** ObjectId — 24-hex 소문자/대문자 모두 허용 (mongo canonical 은 소문자
 *  이지만 사용자 input 은 대문자도 흔하다). */
const OID_REGEX = /^[0-9a-fA-F]{24}$/;
/** Base64 strict — `=` padding 까지 허용. 1자~수천자 길이. */
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;
/** Decimal — 사용자 입력 numeric string. 부호, 소수점, 지수 허용. */
const DECIMAL_REGEX = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** canonical EJSON wrapper 면 그 type, 아니면 null. multi-key object 는
 *  wrapper 가 아니므로 null. */
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

/** raw user input → canonical EJSON object, 또는 검증 실패 메시지. */
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

/** canonical EJSON wrapper → 사용자가 편집할 raw string. detect 미스매치
 *  시에도 best-effort 반환 (호출자 책임으로 검증). */
export function ejsonToEditableString(type: BsonType, value: unknown): string {
  if (!isPlainRecord(value)) return "";
  switch (type) {
    case "objectId": {
      const v = value["$oid"];
      return typeof v === "string" ? v : "";
    }
    case "date": {
      const v = value["$date"];
      if (typeof v === "string") return v;
      // canonical EJSON v2 numberLong shape
      if (isPlainRecord(v) && typeof v["$numberLong"] === "string") {
        const ms = Number.parseInt(v["$numberLong"] as string, 10);
        if (Number.isInteger(ms)) return new Date(ms).toISOString();
      }
      return "";
    }
    case "decimal128": {
      const v = value["$numberDecimal"];
      return typeof v === "string" ? v : "";
    }
    case "binData": {
      const v = value["$binary"];
      if (isPlainRecord(v) && typeof v["base64"] === "string") {
        return v["base64"] as string;
      }
      return "";
    }
  }
}
