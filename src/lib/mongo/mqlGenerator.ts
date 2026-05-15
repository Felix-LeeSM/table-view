/**
 * MongoDB Query Language (MQL) preview + command generator. Mirrors
 * `sqlGenerator.ts` for the document paradigm: consumes the same
 * pending-diff shape (cell edits, deleted rows, new rows) and produces:
 *
 * 1. `previewLines` — `string[]` for the preview modal, ordered
 *    insert → update → delete.
 * 2. `commands` — `MqlCommand[]` ready to dispatch to
 *    `insertDocument` / `updateDocument` / `deleteDocument`. Index `i`
 *    matches `previewLines[i]`.
 * 3. `errors` — per-row generation failures. An errored row is skipped
 *    in both arrays; valid rows in the same batch still emit entries.
 *
 * Policy:
 * - Updates wrap the per-row patch in a single `$set`. Top-level fields
 *   only — dot-path / nested-field editing is out of scope.
 * - `_id` in a `$set` patch is rejected here (the backend rejects it
 *   too); the preview never shows an unexecutable statement.
 * - Sentinel cells (`"{...}"` for documents, `"[N items]"` for arrays)
 *   are not editable — a pending edit on one drops the row with a
 *   `sentinel-edit` error.
 * - Rows whose `_id` can't be lifted into a `DocumentId` (missing,
 *   null, composite) drop with a `missing-id` error.
 */

import {
  documentIdFromRow,
  formatDocumentIdForMql,
  type DocumentId,
} from "@/types/documentMutate";
import { isDocumentSentinel } from "@/types/document";
import { safeStringifyCell } from "@lib/jsonCell";

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
  /** `"{rowIdx}-{colIdx}"` → raw edited cell value. Accepts `unknown`
   *  rather than `string | null` so richer editors don't force a new
   *  generator. */
  pendingEdits: Map<string, unknown>;
  /** `"row-{page}-{rowIdx}"` — same encoding as the RDB path. */
  pendingDeletedRowKeys: Set<string>;
  /** Record-shaped new rows. Document inserts carry arbitrary top-level
   *  keys rather than positional column cells because the collection has no
   *  enforced schema. */
  pendingNewRows: Record<string, unknown>[];
}

/** A single MQL command ready to dispatch to the Tauri wrappers. */
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
  // Objects/arrays — safeStringifyCell so nested BigInt (Mongo Int64 / NumberLong)
  // 가 들어와도 preview 가 throw 하지 않는다 (Sprint 306). commit payload
  // 는 별도 path 라 preview 텍스트의 BigInt-as-string 직렬화는 안전.
  return safeStringifyCell(value);
}

/** Render a flat object as ` { key: <val>, … }` for the preview string.
 *  Keys are unquoted when they are valid JS identifiers; keys containing a
 *  `.` (dot-notation paths from Sprint 322 F.2 nested edits) or other
 *  non-identifier chars are double-quoted so the rendered preview is valid
 *  mongosh syntax. */
function formatMqlObjectKey(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  return `"${key.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function formatMqlObject(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj);
  if (entries.length === 0) return "{}";
  const inner = entries
    .map(
      ([key, value]) => `${formatMqlObjectKey(key)}: ${formatMqlValue(value)}`,
    )
    .join(", ");
  return `{ ${inner} }`;
}

/** `"rowIdx-colIdx"` → `[rowIdx, colIdx, null]`, or with a dot-path
 *  suffix `"rowIdx-colIdx:path.to.field"` → `[rowIdx, colIdx, "path.to.field"]`.
 *  Returns `null` for malformed keys so we never silently splice `NaN`
 *  into a preview string. Sprint 322 (Slice F.2) — nested edit support. */
function parseEditKey(key: string): [number, number, string | null] | null {
  const [head, ...rest] = key.split(":");
  const path = rest.length > 0 ? rest.join(":") : null;
  const parts = head!.split("-");
  if (parts.length !== 2) return null;
  const rowIdx = Number.parseInt(parts[0]!, 10);
  const colIdx = Number.parseInt(parts[1]!, 10);
  if (!Number.isInteger(rowIdx) || !Number.isInteger(colIdx)) return null;
  return [rowIdx, colIdx, path];
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
  // Sprint 322 — Slice F.2: `column` 은 dot-path 가 포함된 patch
  // field path (예: `meta.verified`). top-level edit 는 path === null
  // → bare column name. nested edit (path !== null) 는 sentinel-edit
  // guard 와 `_id`-in-patch guard 의 대상이 아님 (sentinel column
  // 자체는 read-only 지만, 그 안의 1-depth scalar 는 dot-notation
  // `$set` 으로 update 가능).
  const editsByRow = new Map<
    number,
    Array<{ column: string; value: unknown; nested: boolean }>
  >();
  pendingEdits.forEach((value, key) => {
    const parsed = parseEditKey(key);
    if (parsed === null) return;
    const [rowIdx, colIdx, path] = parsed;
    const col = columns[colIdx];
    if (!col) return;
    const fieldPath = path !== null ? `${col.name}.${path}` : col.name;
    const existing = editsByRow.get(rowIdx);
    const entry = { column: fieldPath, value, nested: path !== null };
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

    // Sentinel-edit guard: any *top-level* cell (path === null) whose value
    // is the document/array sentinel is not editable directly — the user
    // should use the F.1 expand popover instead. nested edits (path !== null)
    // are by construction targeting fields inside that sentinel and are
    // allowed.
    let sentinelBlocked = false;
    for (const { column, value, nested } of cells) {
      if (!nested && isDocumentSentinel(value)) {
        errors.push({ kind: "sentinel-edit", rowIdx, column });
        sentinelBlocked = true;
      }
    }
    if (sentinelBlocked) return;

    // `_id`-in-patch guard: the backend rejects patch documents with a
    // top-level `_id`; matching the behaviour here keeps the preview honest.
    // Nested paths under `_id` are exotic but rejected too (you can't $set
    // into a foreign-shaped _id).
    const idInPatch = cells.find(
      (c) => c.column === "_id" || c.column.startsWith("_id."),
    );
    if (idInPatch) {
      errors.push({ kind: "id-in-patch", rowIdx, column: idInPatch.column });
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
