// Sprint 261 (ADR 0026) — type-aware post-processing for IPC responses.
//
// PostgreSQL `bigint` / `numeric` and MongoDB `Int64` / `Decimal128` are
// emitted by the Rust backend as JSON string tokens to preserve digit-for-
// digit precision through `JSON.parse`. This helper inspects each column's
// `dataType` (or legacy `data_type`) and replaces those string cells
// with `BigInt(...)` or `new Decimal(...)`. All other cells (int4, real,
// boolean, text, extjson wrappers, null) pass through unchanged.
//
// Same column = same JS type for every row, by design. Renderers and
// editors branch on `typeof cell === "bigint"` / `cell instanceof Decimal`
// once and the row layer doesn't need to re-derive type from the value.

import Decimal from "decimal.js";

type Wrapper = "bigint" | "decimal" | "passthrough";

interface ColumnLike {
  dataType?: string;
  data_type?: string;
}

// Declared types whose backend wire cells are precision-sensitive 64-bit
// integers, emitted as string tokens and promoted to BigInt here.
// - PG: bigint / int8 / bigserial (int2/int4/smallint/integer stay Number).
// - MySQL: BIGINT (lowercased) — INT/SMALLINT/etc. are ≤32-bit, wired as Number.
// - SQLite (issue #1082): every INTEGER-affinity declared type. sqlx reports
//   the storage class "integer" for free-form queries, but table preview
//   reports the PRAGMA declared type (int/bigint/smallint/tinyint/mediumint/
//   int2/int4/int8), so all variants are mapped.
// - Mongo: Int64 (schema sniffer reports "int64").
// Listing the small-integer aliases here is safe: wrapNumericCells only
// promotes string cells, and MySQL/PG small integers arrive as Number, so
// they are skipped. Exact matches (not substring) avoid catching PG "point"
// / "int4range" and preserve the no-op fast path for other columns.
const BIGINT_TYPES = new Set([
  "bigint",
  "int8",
  "bigserial",
  "integer",
  "int",
  "smallint",
  "tinyint",
  "mediumint",
  "int2",
  "int4",
  "int64",
]);

function wrapperFor(dataType: string): Wrapper {
  const lower = dataType.toLowerCase();
  if (BIGINT_TYPES.has(lower)) {
    return "bigint";
  }
  if (lower.includes("numeric") || lower.includes("decimal")) {
    return "decimal";
  }
  // Mongo flatten_cell emits Decimal128 as string; the schema sniffer reports
  // the `data_type` string "Decimal128" — match it explicitly.
  if (lower === "decimal128") {
    return "decimal";
  }
  return "passthrough";
}

/**
 * Wrap precision-sensitive cell values in `result.rows` based on the
 * matching column's type. Returns the same object reference with
 * `rows` mutated in place — Tauri invoke just deserialized this payload so
 * we own it, and avoiding a shallow copy keeps the hot path allocation-
 * free.
 *
 * Idempotent: cells already typed as `bigint` or `Decimal` pass through.
 * Cells that are not strings (number, null, object) pass through too —
 * only the contract-defined `string` token gets promoted.
 */
export function wrapNumericCells<
  T extends { columns: ColumnLike[]; rows: unknown[][] },
>(result: T): T {
  const wrappers = result.columns.map((c) =>
    wrapperFor(c.dataType ?? c.data_type ?? ""),
  );
  // Fast path: no precision-sensitive columns means no work.
  if (wrappers.every((w) => w === "passthrough")) {
    return result;
  }
  for (const row of result.rows) {
    for (let i = 0; i < wrappers.length; i++) {
      const wrap = wrappers[i];
      if (wrap === "passthrough") continue;
      const cell = row[i];
      if (typeof cell !== "string") continue;
      if (wrap === "bigint") {
        try {
          row[i] = BigInt(cell);
        } catch {
          // Malformed bigint token (e.g., contains a decimal point or
          // non-digit). Leave the raw string — better than crashing the
          // entire result.
        }
      } else {
        try {
          row[i] = new Decimal(cell);
        } catch {
          // Malformed decimal token. Leave the raw string.
        }
      }
    }
  }
  return result;
}
