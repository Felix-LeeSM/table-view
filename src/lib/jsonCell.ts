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

export function safeStringifyCell(value: unknown): string {
  try {
    const result = JSON.stringify(value, bigIntDecimalReplacer);
    return result ?? UNSERIALIZABLE;
  } catch {
    return UNSERIALIZABLE;
  }
}
