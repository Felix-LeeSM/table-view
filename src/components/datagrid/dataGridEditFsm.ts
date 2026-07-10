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
 * Issue #1174 — stable row-identity string for the pending-edit render
 * overlay. Uses primary-key columns when declared (mirrors
 * `buildWhereClause` + the inline-tree auto-close guard), else the whole
 * row. `safeStringifyCell` keeps Decimal / BigInt / object cells lossless
 * and comparable.
 */
export function rowIdentityKey(
  row: readonly unknown[] | undefined,
  columns: ReadonlyArray<{ is_primary_key: boolean }>,
): string {
  if (!row) return "";
  const pkValues: unknown[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (columns[i]!.is_primary_key) pkValues.push(row[i]);
  }
  return safeStringifyCell(pkValues.length > 0 ? pkValues : (row as unknown));
}

/**
 * Issue #1174 — decide whether the pending edit anchored at `cellKey`
 * (`${rowIdx}-${colIdx}`) still belongs to the row now rendered at that
 * visual index. `pendingEdits` is index-keyed, but each edit captured a
 * row-identity snapshot at edit time (`pendingEditRowSnapshots`, the same
 * anchor the commit's WHERE uses). After pagination / sort / filter the
 * index can point at a different row — so an index-only overlay lights up
 * the WRONG cell. Compare the current row's identity against the anchor's.
 *
 * - No snapshot for the key → pre-#1081 edit or a nested key without an
 *   anchor; fall back to the index match (unchanged behavior → `true`).
 * - Snapshot present → overlay only when the identities match.
 */
export function pendingEditAnchorMatches(
  cellKey: string,
  currentRowIdentity: string,
  columns: ReadonlyArray<{ is_primary_key: boolean }>,
  editRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>> | undefined,
): boolean {
  const snap = editRowSnapshots?.get(cellKey);
  if (!snap) return true;
  return rowIdentityKey(snap, columns) === currentRowIdentity;
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
  // Issue #1081 — row-identity anchors, restored on undo alongside the
  // three diff slices. Must mirror `dataGridEditStore.EditSnapshot`.
  pendingEditRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
  pendingDeletedRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
  // #1126 (ADR 0048) — set on a post-commit snapshot whose committed
  // INSERT/DELETE can't be reproduced: an auto-increment / server-default PK
  // (INSERT reversal) or a deleted row with no captured snapshot (DELETE
  // reversal). `undo()` pops it with a toast instead of staging a wrong-row
  // write. Must mirror `dataGridEditStore.EditSnapshot`.
  restageBlocked?: boolean;
};

export const UNDO_STACK_MAX = 50;

/**
 * #1126 (ADR 0048) — collapse the just-committed pending state into a single
 * reversal snapshot for the undo stack, so a post-commit Cmd+Z re-stages the
 * inverse of what was committed as NEW pending edits (DB writes stay
 * commit-only). Pure Map/Set rebuild — no IPC, no DB write. The reversal's own
 * commit rides the normal preview / Safe Mode pipeline, so an unreproducible
 * reversal is rejected there rather than punched through here.
 *
 * - UPDATE reversal (Phase 1) → edits keyed by the base cell key
 *   (`${rowIdx}-${colIdx}`), value = the ORIGINAL cell from the row-identity
 *   anchor (`pendingEditRowSnapshots`). Nested JSON-path keys collapse to one
 *   whole-cell reversal; the anchor is carried so the reversal's WHERE targets
 *   the row the user touched.
 * - DELETE reversal (Phase 2) → re-INSERT each committed-deleted row from its
 *   `pendingDeletedRowSnapshots` value. Needs the snapshot; a deleted key
 *   without one can't be reproduced → whole commit `restageBlocked`.
 * - INSERT reversal (Phase 2) → DELETE each committed-inserted row, anchored on
 *   the typed new-row values. Reversible only when the table has PK column(s)
 *   AND every new row carries all PK values (auto-increment / server-default PKs
 *   aren't reproducible) → otherwise whole commit `restageBlocked`, so undo pops
 *   it with a toast instead of staging a wrong-row DELETE.
 * - Nothing reversible → `null`; the stack ends up empty.
 */
export function buildRestageSnapshot(
  source: {
    pendingEdits: ReadonlyMap<string, string | null>;
    pendingNewRows: ReadonlyArray<ReadonlyArray<unknown>>;
    pendingDeletedRowKeys: ReadonlySet<string>;
    pendingEditRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;
    pendingDeletedRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  },
  columns?: ReadonlyArray<{ is_primary_key: boolean }>,
): EditSnapshot | null {
  const hasInsert = source.pendingNewRows.length > 0;
  const hasDelete = source.pendingDeletedRowKeys.size > 0;

  // Reproducibility gates. If any add/delete in the commit can't be reversed
  // safely, the whole commit is blocked (matches Phase 1's all-or-nothing).
  const pkIdx: number[] = [];
  if (columns) {
    columns.forEach((c, i) => {
      if (c.is_primary_key) pkIdx.push(i);
    });
  }
  if (hasInsert) {
    const reproducible =
      pkIdx.length > 0 &&
      source.pendingNewRows.every((row) => pkIdx.every((i) => row[i] != null));
    if (!reproducible) return blockedSnapshot();
  }
  if (hasDelete) {
    const snaps = source.pendingDeletedRowSnapshots;
    const reproducible =
      !!snaps && [...source.pendingDeletedRowKeys].every((k) => snaps.has(k));
    if (!reproducible) return blockedSnapshot();
  }

  // UPDATE reversal — restore the anchor's original cell value. The carried
  // anchor must describe the POST-commit row (#1438): a committed PK edit
  // means the DB row now holds the NEW PK, so a WHERE built from the pre-edit
  // anchor would match 0 rows (a silent no-op on dialects without the
  // single-row guard). Overlay every committed top-level value onto the
  // anchor, matched by row identity so a cross-page edit that shares a visual
  // index can't leak its values into another row's anchor (wrong-row write).
  // Nested `:path` fragments are skipped — they can't reconstruct the whole
  // cell, and the untouched PK keeps their WHERE correct.
  const identityCols = columns ?? [];
  const committedTopLevel: Array<{
    colIdx: number;
    value: string | null;
    identity: string;
  }> = [];
  for (const [key, value] of source.pendingEdits) {
    if (key.includes(":")) continue;
    const anchor = source.pendingEditRowSnapshots.get(key);
    if (!anchor) continue;
    committedTopLevel.push({
      colIdx: Number.parseInt(key.split("-")[1]!, 10),
      value,
      identity: rowIdentityKey(anchor, identityCols),
    });
  }

  const reversalEdits = new Map<string, string | null>();
  const reversalAnchors = new Map<string, ReadonlyArray<unknown>>();
  for (const key of source.pendingEdits.keys()) {
    const baseKey = key.split(":")[0]!;
    if (reversalEdits.has(baseKey)) continue;
    const anchor = source.pendingEditRowSnapshots.get(baseKey);
    if (!anchor) continue; // no row identity → can't rebuild the reversal
    const colIdx = Number.parseInt(baseKey.split("-")[1]!, 10);
    reversalEdits.set(baseKey, cellToEditValue(anchor[colIdx]));
    // ponytail: O(edits²) identity scan — pending batches are tiny.
    const identity = rowIdentityKey(anchor, identityCols);
    const committedRow = [...anchor];
    for (const edit of committedTopLevel) {
      if (edit.identity === identity) committedRow[edit.colIdx] = edit.value;
    }
    reversalAnchors.set(baseKey, committedRow);
  }

  // DELETE reversal — re-INSERT each deleted row from its snapshot.
  const snaps = source.pendingDeletedRowSnapshots;
  const reversalNewRows: unknown[][] = hasDelete
    ? [...source.pendingDeletedRowKeys].map((k) => [...snaps!.get(k)!])
    : [];

  // INSERT reversal — DELETE each inserted row, snapshot = the typed values so
  // the reversal's WHERE builds from its own PK. Synthetic, self-unique keys.
  const reversalDeletes = new Set<string>();
  const reversalDeleteSnaps = new Map<string, ReadonlyArray<unknown>>();
  source.pendingNewRows.forEach((row, i) => {
    const key = `row-restage-${i}`;
    reversalDeletes.add(key);
    reversalDeleteSnaps.set(key, [...row]);
  });

  if (
    reversalEdits.size === 0 &&
    reversalNewRows.length === 0 &&
    reversalDeletes.size === 0
  ) {
    return null;
  }
  return {
    pendingEdits: reversalEdits,
    pendingNewRows: reversalNewRows,
    pendingDeletedRowKeys: reversalDeletes,
    pendingEditRowSnapshots: reversalAnchors,
    pendingDeletedRowSnapshots: reversalDeleteSnaps,
  };
}

function blockedSnapshot(): EditSnapshot {
  return {
    pendingEdits: new Map(),
    pendingNewRows: [],
    pendingDeletedRowKeys: new Set(),
    pendingEditRowSnapshots: new Map(),
    pendingDeletedRowSnapshots: new Map(),
    restageBlocked: true,
  };
}
