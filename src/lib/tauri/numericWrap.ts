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

function wrapperFor(dataType: string): Wrapper {
  const lower = dataType.toLowerCase();
  // Decimal first — PG numeric/decimal and Mongo Decimal128 all carry
  // "decimal"/"numeric" in their reported type. Checking before the integer
  // rule keeps them out of the "int" substring match.
  if (lower.includes("decimal") || lower.includes("numeric")) {
    return "decimal";
  }
  // 64-bit-capable integers, wired as string tokens by the backend and
  // promoted to BigInt. Uses SQLite's own affinity rule (a declared type
  // containing "INT" has INTEGER affinity) to cover every variant in one
  // check: SQLite exotic decltypes (UNSIGNED BIG INT / INT2 / INT8 / …), PG
  // bigint/int8/bigserial, MySQL "BIGINT" and "BIGINT UNSIGNED", and Mongo
  // Int64. wrapNumericCells only promotes string cells, so:
  // - PG/MySQL small integers arrive as Number and are skipped (no regression);
  // - string types that merely contain "int" (PG "point", "int4range") make
  //   BigInt() throw and fall back to the raw string — harmless.
  if (lower.includes("int") || lower === "bigserial") {
    return "bigint";
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
