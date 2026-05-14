// Pure utilities + resize constants for QuickLook. No JSX so this stays a
// `.ts` file. The per-cell renderers (`FieldRow`, `EditableValue`) live in
// the sibling `FieldRow.tsx`; both bodies (`RdbQuickLookBody`,
// `DocumentQuickLookBody`) import the renderers from `./FieldRow`, and
// `FieldRow` itself imports the helpers below.
import Decimal from "decimal.js";
import type { ColumnInfo } from "@/types/schema";
import { safeStringifyCell } from "@lib/jsonCell";

// ── Resize constants ─────────────────────────────────────────────────

export const MIN_HEIGHT = 120;
export const MAX_HEIGHT = 600;
export const DEFAULT_HEIGHT = 280;
export const KEYBOARD_RESIZE_STEP = 8;

export function clampHeight(value: number): number {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, value));
}

// ── Column-family predicates ─────────────────────────────────────────

export function isBlobColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return (
    lower.includes("blob") ||
    lower.includes("bytea") ||
    lower.includes("binary") ||
    lower.includes("varbinary") ||
    lower.includes("image")
  );
}

export function isJsonColumn(dataType: string): boolean {
  return dataType.toLowerCase().includes("json");
}

export function isBoolColumn(dataType: string): boolean {
  const lower = dataType.toLowerCase();
  return lower === "bool" || lower.includes("boolean");
}

/** Try to detect JSON-like string values. */
export function looksLikeJson(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  );
}

export function formatCellValue(value: unknown, col: ColumnInfo): string {
  if (value == null) return "NULL";
  if (typeof value === "boolean") return value ? "true" : "false";
  // Sprint 305 — ADR 0026 precision-preserving cell type. Decimal 는
  // `typeof === "object"` 라 generic branch 가 `{}` 로 emit, BigInt 는
  // raw JSON.stringify 가 throw → QuickLook 마운트 시점 freeze.
  if (value instanceof Decimal) return value.toString();
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object") return safeStringifyCell(value, 2);
  // String values that look like JSON
  if (isJsonColumn(col.data_type) || looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value as string);
      return safeStringifyCell(parsed, 2);
    } catch {
      // String didn't parse as JSON — render verbatim.
      return String(value);
    }
  }
  return String(value);
}

// Column is editable in QuickLook iff (a) editState available, (b) not a
// primary key, (c) not a BLOB family. Generated/computed columns fall
// through the same gate via the underlying hook's commit path.
export function isEditableColumn(col: ColumnInfo): boolean {
  if (col.is_primary_key) return false;
  if (isBlobColumn(col.data_type)) return false;
  return true;
}

// Does the selected row have any pending change? Pending edits carry the
// row idx as a `${rowIdx}-${colIdx}` prefix; pendingDeletedRowKeys uses a
// page-aware row key the panel does not have, so we only check the edit
// map. New-row inserts are addressed via separate dedicated UI.
export function selectedRowIsDirty(
  selectedRowIdx: number | null,
  pendingEdits: Map<string, string | null>,
): boolean {
  if (selectedRowIdx == null) return false;
  const prefix = `${selectedRowIdx}-`;
  for (const key of pendingEdits.keys()) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}
