// Sprint 261 (ADR 0026) — type-aware post-processing for IPC responses.
//
// PostgreSQL `bigint` / `numeric` and MongoDB `Int64` / `Decimal128` are
// emitted by the Rust backend as JSON string tokens to preserve digit-for-
// digit precision through `JSON.parse`. This helper inspects each column's
// `data_type` (the single source of truth) and replaces those string cells
// with `BigInt(...)` or `new Decimal(...)`. All other cells (int4, real,
// boolean, text, extjson wrappers, null) pass through unchanged.
//
// Same column = same JS type for every row, by design. Renderers and
// editors branch on `typeof cell === "bigint"` / `cell instanceof Decimal`
// once and the row layer doesn't need to re-derive type from the value.

import Decimal from "decimal.js";

type Wrapper = "bigint" | "decimal" | "passthrough";

interface ColumnLike {
  data_type: string;
}

function wrapperFor(dataType: string): Wrapper {
  const lower = dataType.toLowerCase();
  if (lower === "bigint" || lower === "int8" || lower === "bigserial") {
    return "bigint";
  }
  if (lower.includes("numeric") || lower.includes("decimal")) {
    return "decimal";
  }
  // Mongo flatten_cell emits Int64 / Decimal128 as string. The Mongo
  // `data_type` strings reported by the schema sniffer are "Int64" and
  // "Decimal128" — match those explicitly.
  if (lower === "int64") {
    return "bigint";
  }
  if (lower === "decimal128") {
    return "decimal";
  }
  return "passthrough";
}

/**
 * Wrap precision-sensitive cell values in `result.rows` based on the
 * matching column's `data_type`. Returns the same object reference with
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
  const wrappers = result.columns.map((c) => wrapperFor(c.data_type));
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
