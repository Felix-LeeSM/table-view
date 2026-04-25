/**
 * MongoDB Query Language (MQL) preview + command generator (Sprint 86).
 *
 * Mirrors `sqlGenerator.ts` for the document paradigm. Consumes the same
 * "pending diff" shape the DataGrid accumulates for the RDB paradigm — cell
 * edits, deleted rows, and newly-added rows — and produces three outputs:
 *
 * 1. `previewLines` — a `string[]` suitable for a `QueryPreviewModal` (Sprint
 *    87) rendering `db.<collection>.(insertOne|updateOne|deleteOne)(…)` text,
 *    ordered insert → update → delete so a user reading the preview sees
 *    inserts before any subsequent mutation on the same document.
 * 2. `commands` — a 1:1 `MqlCommand[]` payload array ready to dispatch to
 *    `insertDocument` / `updateDocument` / `deleteDocument` Tauri wrappers
 *    (see `src/lib/tauri.ts`). Index `i` of `commands` corresponds to line
 *    `i` of `previewLines`.
 * 3. `errors` — per-row generation failures that the commit flow can surface
 *    in the UI. A row that generated an error is **skipped** in both
 *    `previewLines` and `commands`; valid rows in the same batch still
 *    produce preview/command entries.
 *
 * Policy (Phase 6 plan F):
 * - Updates always wrap the per-row patch in a single `$set` operator. Dot-
 *   path / nested-field editing is a future phase; Sprint 86 only emits
 *   top-level field edits.
 * - The generator refuses to include `_id` in a `$set` patch — Sprint 80's
 *   backend rejects the same case, and guarding here keeps the preview
 *   honest (the user never sees a statement that would fail server-side).
 * - Sentinel cells (`"{...}"` for nested documents, `"[N items]"` for nested
 *   arrays) are not editable — a pending edit against one surfaces a
 *   `sentinel-edit` error and drops the row.
 * - Rows whose `_id` cannot be lifted into a `DocumentId` (missing, null,
 *   composite) surface a `missing-id` error and drop the row.
 * - Sprint 87 consumes this module's output. Sprint 86 does not wire the
 *   generator into any component — it exists behind the `useDataGridEdit`
 *   hook's document paradigm branch only.
 */

import {
  documentIdFromRow,
  formatDocumentIdForMql,
  type DocumentId,
} from "@/types/documentMutate";
import { isDocumentSentinel } from "@/types/document";

/** Column shape the generator needs — structurally compatible with the
 *  `ColumnInfo` used by the RDB path, but intentionally narrower so callers
 *  can adapt any columns array without pulling in schema-only fields. */
export interface MqlGridColumn {
  name: string;
  data_type: string;
  is_primary_key: boolean;
}

/** Input bundle for {@link generateMqlPreview}. Mirrors the parameter shape
 *  of the RDB `generateSql` generator so callers can forward the same
 *  pending-diff maps that `useDataGridEdit` already tracks. */
export interface MqlGenerateInput {
  database: string;
  collection: string;
  columns: MqlGridColumn[];
  rows: unknown[][];
  /** Page number of the current view — used to decode `"row-{page}-{idx}"`
   *  delete keys. Mirrors `useDataGridEdit.rowKeyFn`. */
  page: number;
  /** `"{rowIdx}-{colIdx}"` → raw edited cell value (string | null for RDB-
   *  shaped edits, or `unknown` for document edits coming from richer
   *  editors — Sprint 87). We accept the widest type here so the future
   *  richer editors do not require a new generator. */
  pendingEdits: Map<string, unknown>;
  /** `"row-{page}-{rowIdx}"` — same encoding as the RDB path. */
  pendingDeletedRowKeys: Set<string>;
  /** Record-shaped new rows. Document inserts carry arbitrary top-level
   *  keys rather than positional column cells because the collection has no
   *  enforced schema. */
  pendingNewRows: Record<string, unknown>[];
}

/** A single MQL command ready to dispatch to the Sprint 80 Tauri wrappers. */
export type MqlCommand =
  | {
      kind: "insertOne";
      database: string;
      collection: string;
      document: Record<string, unknown>;
    }
  | {
      kind: "updateOne";
      database: string;
      collection: string;
      documentId: DocumentId;
      patch: Record<string, unknown>;
    }
  | {
      kind: "deleteOne";
      database: string;
      collection: string;
      documentId: DocumentId;
    };

export type MqlGenerationError =
  | { kind: "missing-id"; rowIdx: number }
  | { kind: "id-in-patch"; rowIdx: number; column: string }
  | { kind: "sentinel-edit"; rowIdx: number; column: string }
  | { kind: "invalid-new-row"; rowIdx: number; reason: string };

export interface MqlPreview {
  previewLines: string[];
  commands: MqlCommand[];
  errors: MqlGenerationError[];
}

/** Render a JS value into mongosh-flavoured literal text. Strings are
 *  double-quoted and escape `\\"`; numbers/booleans/null use their native
 *  JS representation; objects and arrays route through `JSON.stringify` so
 *  the preview remains readable without a full AST printer. */
function formatMqlValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  // Objects/arrays — JSON.stringify is good enough for a preview. The commit
  // payload goes through Tauri's serde-json path, not this text.
  return JSON.stringify(value);
}

/** Render a flat object as ` { key: <val>, … }` (unquoted keys) for the
 *  preview string. Key order follows insertion order which in turn follows
 *  the generator's iteration order over pending edits / new row fields. */
function formatMqlObject(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return "{}";
  const inner = entries
    .map(([key, value]) => `${key}: ${formatMqlValue(value)}`)
    .join(", ");
  return `{ ${inner} }`;
}

/** `"rowIdx-colIdx"` → `[rowIdx, colIdx]`. Returns `null` for malformed keys
 *  so we never silently splice `NaN` into a preview string. */
function parseEditKey(key: string): [number, number] | null {
  const parts = key.split("-");
  if (parts.length !== 2) return null;
  const rowIdx = Number.parseInt(parts[0]!, 10);
  const colIdx = Number.parseInt(parts[1]!, 10);
  if (!Number.isInteger(rowIdx) || !Number.isInteger(colIdx)) return null;
  return [rowIdx, colIdx];
}

/** Decode a `"row-{page}-{rowIdx}"` delete key into its `rowIdx`. The
 *  generator does not strictly need the page component — we stay defensive
 *  and accept the key even if the page doesn't match the current view (the
 *  UI only tracks deletes for rows currently visible). */
function parseDeleteKey(key: string): number | null {
  const parts = key.split("-");
  if (parts.length !== 3 || parts[0] !== "row") return null;
  const rowIdx = Number.parseInt(parts[2]!, 10);
  if (!Number.isInteger(rowIdx)) return null;
  return rowIdx;
}

/** Convert a DataGrid positional row into a record keyed by column name —
 *  `documentIdFromRow` and the patch-aggregation step both want record
 *  semantics. Values are passed through unchanged so sentinel strings stay
 *  detectable downstream. */
function rowToRecord(
  row: unknown[],
  columns: MqlGridColumn[],
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  columns.forEach((col, idx) => {
    record[col.name] = row[idx];
  });
  return record;
}

export function generateMqlPreview(input: MqlGenerateInput): MqlPreview {
  const {
    database,
    collection,
    columns,
    rows,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
  } = input;

  const errors: MqlGenerationError[] = [];
  const insertLines: string[] = [];
  const insertCommands: MqlCommand[] = [];
  const updateLines: string[] = [];
  const updateCommands: MqlCommand[] = [];
  const deleteLines: string[] = [];
  const deleteCommands: MqlCommand[] = [];

  // ── Update path ─────────────────────────────────────────────────────────
  // Group pending edits by rowIdx so each row produces at most one updateOne
  // (matches MongoDB's "one `$set` per patch" policy). The grouping map
  // preserves insertion order of (row, col) so the patch preview is
  // deterministic across runs with the same pending state.
  const editsByRow = new Map<
    number,
    Array<{ column: string; value: unknown }>
  >();
  pendingEdits.forEach((value, key) => {
    const parsed = parseEditKey(key);
    if (parsed === null) return;
    const [rowIdx, colIdx] = parsed;
    const col = columns[colIdx];
    if (!col) return;
    const existing = editsByRow.get(rowIdx);
    const entry = { column: col.name, value };
    if (existing) {
      existing.push(entry);
    } else {
      editsByRow.set(rowIdx, [entry]);
    }
  });

  editsByRow.forEach((cells, rowIdx) => {
    const row = rows[rowIdx];
    if (!row) {
      errors.push({ kind: "missing-id", rowIdx });
      return;
    }

    // Sentinel-edit guard: any cell whose value is the document/array
    // sentinel is not editable. Each offending cell reports its own error
    // and the row is dropped entirely (Sprint 86 does not emit a partial
    // patch — the user must discard the sentinel edit first).
    let sentinelBlocked = false;
    for (const { column, value } of cells) {
      if (isDocumentSentinel(value)) {
        errors.push({ kind: "sentinel-edit", rowIdx, column });
        sentinelBlocked = true;
      }
    }
    if (sentinelBlocked) return;

    // `_id`-in-patch guard: the Sprint 80 backend rejects a patch document
    // with a top-level `_id` key; matching the behaviour here keeps the
    // preview honest.
    const idInPatch = cells.find((c) => c.column === "_id");
    if (idInPatch) {
      errors.push({ kind: "id-in-patch", rowIdx, column: "_id" });
      return;
    }

    const rowRecord = rowToRecord(row, columns);
    const id = documentIdFromRow(rowRecord);
    if (id === null) {
      errors.push({ kind: "missing-id", rowIdx });
      return;
    }

    const patch: Record<string, unknown> = {};
    for (const { column, value } of cells) {
      patch[column] = value;
    }
    // Empty patch (all edits resolved back to original values upstream)
    // should never happen because `useDataGridEdit` already prunes those,
    // but we guard defensively — generating `updateOne({_id}, {$set: {}})`
    // is a server-side no-op that still costs a roundtrip.
    if (Object.keys(patch).length === 0) return;

    const filterLiteral = `{ _id: ${formatDocumentIdForMql(id)} }`;
    const patchLiteral = `{ $set: ${formatMqlObject(patch)} }`;
    updateLines.push(
      `db.${collection}.updateOne(${filterLiteral}, ${patchLiteral})`,
    );
    updateCommands.push({
      kind: "updateOne",
      database,
      collection,
      documentId: id,
      patch,
    });
  });

  // ── Delete path ─────────────────────────────────────────────────────────
  pendingDeletedRowKeys.forEach((delKey) => {
    const rowIdx = parseDeleteKey(delKey);
    if (rowIdx === null) return;
    const row = rows[rowIdx];
    if (!row) {
      errors.push({ kind: "missing-id", rowIdx });
      return;
    }
    const rowRecord = rowToRecord(row, columns);
    const id = documentIdFromRow(rowRecord);
    if (id === null) {
      errors.push({ kind: "missing-id", rowIdx });
      return;
    }
    deleteLines.push(
      `db.${collection}.deleteOne({ _id: ${formatDocumentIdForMql(id)} })`,
    );
    deleteCommands.push({
      kind: "deleteOne",
      database,
      collection,
      documentId: id,
    });
  });

  // ── Insert path ─────────────────────────────────────────────────────────
  pendingNewRows.forEach((document, rowIdx) => {
    // Sentinel-in-insert guard: a new row with a sentinel cell means the
    // caller forwarded a placeholder string through an insert — reject so
    // the user fixes the value first.
    let sentinelBlocked = false;
    for (const [column, value] of Object.entries(document)) {
      if (isDocumentSentinel(value)) {
        errors.push({ kind: "sentinel-edit", rowIdx, column });
        sentinelBlocked = true;
      }
    }
    if (sentinelBlocked) return;

    // Drop `undefined` entries so the resulting document matches what JSON
    // serialisation would produce — `undefined` is not a valid JSON value
    // and the Tauri bridge would error on it anyway.
    const cleaned: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(document)) {
      if (value !== undefined) cleaned[column] = value;
    }
    if (Object.keys(cleaned).length === 0) {
      errors.push({
        kind: "invalid-new-row",
        rowIdx,
        reason: "new row has no fields",
      });
      return;
    }

    insertLines.push(`db.${collection}.insertOne(${formatMqlObject(cleaned)})`);
    insertCommands.push({
      kind: "insertOne",
      database,
      collection,
      document: cleaned,
    });
  });

  return {
    previewLines: [...insertLines, ...updateLines, ...deleteLines],
    commands: [...insertCommands, ...updateCommands, ...deleteCommands],
    errors,
  };
}
