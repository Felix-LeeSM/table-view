import Decimal from "decimal.js";
import { safeStringifyCell } from "@lib/jsonCell";

/**
 * Edit key helper: maps row/col indices to a unique string key.
 */
export function editKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/**
 * Row key helper: identifies a row across pages.
 */
export function rowKeyFn(rowIdx: number, page: number): string {
  return `row-${page}-${rowIdx}`;
}

/**
 * Determine the HTML input type for a given column data type.
 */
export function getInputTypeForColumn(dataType: string): string {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp")) return "datetime-local";
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  return "text";
}

/**
 * Result of {@link deriveEditorSeed}. `accept: false` means the keystroke is
 * not a legal first character for this column type and the caller should
 * swallow the event without changing state.
 */
export interface EditorSeed {
  seed: string;
  accept: boolean;
}

function classifyDataType(
  dataType: string,
):
  | "integer"
  | "numeric"
  | "date"
  | "datetime"
  | "time"
  | "boolean"
  | "uuid"
  | "text" {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp") || lower.includes("datetime")) {
    return "datetime";
  }
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  if (lower === "bool" || lower.includes("boolean")) return "boolean";
  if (lower.includes("uuid")) return "uuid";
  if (
    lower.includes("int") ||
    lower === "serial" ||
    lower === "bigserial" ||
    lower === "smallserial"
  ) {
    return "integer";
  }
  if (
    lower.includes("numeric") ||
    lower.includes("decimal") ||
    lower.includes("float") ||
    lower.includes("double") ||
    lower.includes("real")
  ) {
    return "numeric";
  }
  return "text";
}

/**
 * Given a column's data type and a printable keystroke, decide whether to
 * resume editing and with what seed when the user types from the NULL chip.
 */
export function deriveEditorSeed(dataType: string, key: string): EditorSeed {
  const family = classifyDataType(dataType);
  switch (family) {
    case "integer": {
      if (/^[0-9-]$/.test(key)) return { seed: key, accept: true };
      return { seed: "", accept: false };
    }
    case "numeric": {
      if (/^[0-9.-]$/.test(key)) return { seed: key, accept: true };
      return { seed: "", accept: false };
    }
    case "date":
    case "datetime":
    case "time":
    case "boolean":
    case "uuid": {
      return { seed: "", accept: true };
    }
    case "text":
    default:
      return { seed: key, accept: true };
  }
}

/**
 * Render a raw cell value as a displayable string.
 */
export function cellToEditString(cell: unknown): string {
  if (cell == null) return "";
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object") return safeStringifyCell(cell, 2);
  return String(cell);
}

/**
 * Edit-path counterpart of `cellToEditString`. Preserves SQL NULL intent:
 * null/undefined returns `null`, while empty-string returns `""`.
 */
export function cellToEditValue(cell: unknown): string | null {
  if (cell == null) return null;
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object") return safeStringifyCell(cell, 2);
  return String(cell);
}

/**
 * Apply a cell edit, but skip or remove the pending entry when the value
 * matches the original cell.
 */
export function applyEditOrClear(
  prev: Map<string, string | null>,
  key: string,
  value: string | null,
  originalValue: string | null,
): Map<string, string | null> {
  if (value === originalValue) {
    if (!prev.has(key)) return prev;
    const next = new Map(prev);
    next.delete(key);
    return next;
  }
  const next = new Map(prev);
  next.set(key, value);
  return next;
}

/**
 * Surfaced commit failure for the SQL preview modal.
 */
export interface CommitError {
  statementIndex: number;
  statementCount: number;
  sql: string;
  message: string;
  failedKey?: string;
}

/**
 * Snapshot of the pending-state slices captured before a mutating handler
 * applies its change.
 */
export type EditSnapshot = {
  pendingEdits: ReadonlyMap<string, string | null>;
  pendingNewRows: ReadonlyArray<ReadonlyArray<unknown>>;
  pendingDeletedRowKeys: ReadonlySet<string>;
};

export const UNDO_STACK_MAX = 50;
