// Sprint 211 — pure utilities + resize constants for QuickLook. No JSX
// (so this stays a `.ts` file as the sprint contract verification check
// requires). The per-cell renderers (`FieldRow`, `EditableValue`) live in
// the sibling `FieldRow.tsx` because JSX cannot be parsed inside a `.ts`
// file under the standard `@vitejs/plugin-react` loader. Both bodies
// (`RdbQuickLookBody`, `DocumentQuickLookBody`) import the renderers from
// `./FieldRow`, and `FieldRow` itself imports the helpers below.
//
// Behavior contract (verbatim from the pre-211 god file): `formatCellValue`
// keeps its existing inline justification comments for the
// `JSON.stringify` cycle and `JSON.parse` swallows. No new `catch {}`
// introduced.
import type { ColumnInfo } from "@/types/schema";

// ── Resize constants (Sprint 105 #QL-1) ──────────────────────────────

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
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      // Value has cycles — fall back to String().
      return String(value);
    }
  }
  // String values that look like JSON
  if (isJsonColumn(col.data_type) || looksLikeJson(value)) {
    try {
      const parsed = JSON.parse(value as string);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // String didn't parse as JSON — render verbatim.
      return String(value);
    }
  }
  return String(value);
}

// Sprint 194 — column is editable in QuickLook iff (a) editState available,
// (b) not a primary key, (c) not a BLOB family. Generated/computed columns
// fall through the same gate via the underlying hook's commit path.
export function isEditableColumn(col: ColumnInfo): boolean {
  if (col.is_primary_key) return false;
  if (isBlobColumn(col.data_type)) return false;
  return true;
}

// Sprint 194 — does the selected row have any pending change? Pending edits
// carry the row idx as a `${rowIdx}-${colIdx}` prefix; pendingDeletedRowKeys
// uses a page-aware row key the panel does not have, so we only check the
// edit map for V1. New-row inserts are addressed via separate dedicated UI.
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
