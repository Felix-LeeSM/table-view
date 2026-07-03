import Decimal from "decimal.js";

const UNSERIALIZABLE = '"[unserializable]"';

/**
 * Sprint 261 (ADR 0026) — BigInt / Decimal cells round-trip to digit
 * strings so cell tooltips, query history snapshots, CSV / JSON export,
 * and the QuickLook tree viewer never throw on the new precision-
 * preserving cell types. Native `JSON.stringify` raises on BigInt and
 * emits `{}` for Decimal (no enumerable props), neither of which matches
 * the wire shape Sprint 261 commits to.
 */
function bigIntDecimalReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Decimal) return value.toString();
  return value;
}

export function safeStringifyCell(value: unknown, indent?: number): string {
  try {
    const result = JSON.stringify(value, bigIntDecimalReplacer, indent);
    return result ?? UNSERIALIZABLE;
  } catch {
    return UNSERIALIZABLE;
  }
}

/**
 * Convert BigInt / Decimal cells back to their wire-string form before an
 * argument crosses the Tauri IPC boundary. Tauri serializes invoke args with
 * native `JSON.stringify`, which throws `TypeError: Do not know how to
 * serialize a BigInt` (and flattens Decimal to `{}`). This returns the same
 * digit strings the backend originally emitted per ADR 0026, so precision is
 * preserved digit-for-digit. `wrapNumericCells` promoted these to BigInt /
 * Decimal on the way in; this reverses that on the way out.
 *
 * Shallow by design: `wrapNumericCells` only promotes top-level cells, so
 * nested objects (e.g. Mongo Extended JSON) never contain a BigInt.
 */
export function toIpcSafeRows(rows: unknown[][]): unknown[][] {
  return rows.map((row) =>
    row.map((cell) =>
      typeof cell === "bigint" || cell instanceof Decimal
        ? cell.toString()
        : cell,
    ),
  );
}
