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
 *   and dot-paths from F.2 nested edits. Sprint 342 (V2) — structural
 *   edits join the same per-row patch: cells whose value equals the
 *   sentinel string `__op__:unset` lift into `$unset` instead of `$set`,
 *   so a row can mix add-key / overwrite / delete in one round-trip.
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
import { detectBsonType } from "@lib/mongo/bsonTypes";

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
  /**
   * Issue #1081 — row-identity anchors captured at edit/delete time. When
   * present, the `_id` filter for updateOne/deleteOne is derived from the
   * snapshot instead of the current page's `rows[rowIdx]`, so paginating
   * away can't retarget the write. Keyed by the base CELL key
   * `${rowIdx}-${colIdx}` (edits; nested `:path` keys resolve their base cell
   * key) and the full delete key `row-${page}-${rowIdx}` (deletes).
   */
  editRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  deletedRowSnapshots?: ReadonlyMap<string, ReadonlyArray<unknown>>;
  /**
   * Issue #1704 — the original (non-sentinelised) documents for the current
   * page, index-aligned with `rows`. Only the document paradigm supplies this;
   * the generator needs the real array value to turn an array-element delete
   * (`__op__:unset` on `tags[0]`) into a whole-array `$set` splice instead of a
   * positional `$unset` (which MongoDB resolves to a `null` hole). Absent →
   * the generator keeps the plain `$unset` behaviour.
   */
  rawDocuments?: ReadonlyArray<Record<string, unknown>>;
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

/**
 * Issue #1440 — pending-state origin of `commands[i]` (index-aligned, same
 * contract as `previewLines`). A partially-applied bulk commit uses this to
 * prune exactly the applied ops from the pending slices so a re-commit
 * cannot duplicate them:
 *   - `insert` — index into the caller's `pendingNewRows`.
 *   - `update` — the full `pendingEdits` keys (incl. nested `:path` suffix)
 *     merged into that document's single updateOne.
 *   - `delete` — the `pendingDeletedRowKeys` entry.
 */
export type MqlCommandSource =
  | { kind: "insert"; newRowIndex: number }
  | { kind: "update"; editKeys: string[] }
  | { kind: "delete"; deleteKey: string };

export interface MqlPreview {
  previewLines: string[];
  commands: MqlCommand[];
  /** Issue #1440 — `sources[i]` describes the pending origin of `commands[i]`. */
  sources: MqlCommandSource[];
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
  // Sprint 324 — Slice G.2: canonical EJSON wrapper 는 mongosh literal
  // 표기 (ObjectId / ISODate / NumberDecimal / BinData) 로 풀어 보여
  // 사용자가 preview 에서 type 을 즉시 인지하도록 한다. multi-key /
  // 미지원 wrapper 는 plain JSON fallback.
  const bsonLiteral = tryFormatBsonLiteral(value);
  if (bsonLiteral !== null) return bsonLiteral;
  // Objects/arrays — safeStringifyCell so nested BigInt (Mongo Int64 / NumberLong)
  // 가 들어와도 preview 가 throw 하지 않는다 (Sprint 306). commit payload
  // 는 별도 path 라 preview 텍스트의 BigInt-as-string 직렬화는 안전.
  return safeStringifyCell(value);
}

/** canonical EJSON 4 wrapper → mongosh literal. 미인식 시 null
 *  (호출자가 fallback). */
function tryFormatBsonLiteral(value: unknown): string | null {
  const type = detectBsonType(value);
  if (type === null) return null;
  const obj = value as Record<string, unknown>;
  switch (type) {
    case "objectId": {
      const oid = obj["$oid"];
      if (typeof oid !== "string") return null;
      return `ObjectId("${oid}")`;
    }
    case "date": {
      const d = obj["$date"];
      if (typeof d === "string") return `ISODate("${d}")`;
      // canonical EJSON v2 numberLong shape — preserve roundtrip readability.
      if (
        typeof d === "object" &&
        d !== null &&
        "$numberLong" in (d as Record<string, unknown>)
      ) {
        const ms = (d as Record<string, unknown>)["$numberLong"];
        if (typeof ms === "string") {
          const iso = new Date(Number.parseInt(ms, 10)).toISOString();
          return `ISODate("${iso}")`;
        }
      }
      return null;
    }
    case "decimal128": {
      const n = obj["$numberDecimal"];
      if (typeof n !== "string") return null;
      return `NumberDecimal("${n}")`;
    }
    case "binData": {
      const b = obj["$binary"];
      if (typeof b !== "object" || b === null) return null;
      const inner = b as Record<string, unknown>;
      const base64 = inner["base64"];
      const subType = inner["subType"];
      if (typeof base64 !== "string" || typeof subType !== "string") {
        return null;
      }
      const subInt = Number.parseInt(subType, 16);
      if (!Number.isInteger(subInt)) return null;
      return `BinData(${subInt}, "${base64}")`;
    }
  }
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

/** Join a column name with a nested tree path into a MongoDB dot-notation
 *  field path for `$set` / `$unset`. Tree paths address array elements with
 *  JS-style bracket indices (`items[0].a`, `[0]`, `foo[2].bar`), but MongoDB
 *  addresses array positions with dot-index notation (`items.0.a`) — a
 *  bracketed `[0]` is read as a literal field NAME to create, which fails
 *  with `WriteError code 28` ("Cannot create field '[0]'"; user report
 *  2026-07-18). Convert every `[N]` segment to `.N` and join with the column;
 *  bracket-free object paths (`meta.verified`) pass through unchanged. */
function toMongoFieldPath(columnName: string, path: string): string {
  const dotted = path.replace(/\[(\d+)\]/g, ".$1");
  return dotted.startsWith(".")
    ? `${columnName}${dotted}`
    : `${columnName}.${dotted}`;
}

/** Deep-set `value` at a dot-notation `subPath` inside a container, creating
 *  plain-object intermediates as needed. Mutates `root` (callers pass a clone). */
function deepSetField(root: object, subPath: string, value: unknown): void {
  const segs = subPath.split(".");
  let cur = root as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]!;
    const next = cur[seg];
    if (typeof next !== "object" || next === null) cur[seg] = {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/** Deep-delete the leaf at a dot-notation `subPath` inside a container.
 *  No-op if an intermediate is missing. Mutates `root` (callers pass a clone). */
function deepDeleteField(root: object, subPath: string): void {
  const segs = subPath.split(".");
  let cur = root as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const seg = segs[i]!;
    const next = cur[seg];
    if (typeof next !== "object" || next === null) return;
    cur = next as Record<string, unknown>;
  }
  delete cur[segs[segs.length - 1]!];
}

/** Structural `_id` equality via the canonical MQL literal — used to confirm a
 *  `rawDocuments[rowIdx]` really is the document a pending group targets before
 *  its array is spliced (issue #1704). `a === null` (unliftable id) → false. */
function sameDocumentId(a: DocumentId | null, b: DocumentId): boolean {
  return a !== null && formatDocumentIdForMql(a) === formatDocumentIdForMql(b);
}

/** Navigate a dot-notation `path` inside a raw document, reading a numeric
 *  segment as an array index and any other segment as an object key. Returns
 *  `undefined` when the chain is missing or has the wrong shape. Sprint (issue
 *  #1704) — lets the array-removal step learn whether a `$unset` target's
 *  parent is really an Array (splice) or an object with a numeric key ($unset). */
function rawValueAtPath(root: Record<string, unknown>, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (Array.isArray(cur)) {
      const idx = Number.parseInt(seg, 10);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
    } else if (typeof cur === "object" && cur !== null) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

/**
 * Issue #1704 — turn array-element `$unset` ops into a whole-array `$set`
 * splice so MongoDB REMOVES the element (shifting indices) instead of leaving
 * a positional `null`. Mirrors the Redis `kvJsonWrite.applyTreeEdits` splice
 * that the same DocumentTreePanel drives on the ReJSON path.
 *
 * For each `$unset` path whose last segment is an array index (the value at the
 * parent path in `rawDoc` is an Array), the array is rebuilt on a clone:
 *   1. same-array `$set` edits are applied at their ORIGINAL indices first, so
 *      an edit + delete on one array in a single commit lands before the shift;
 *   2. the deleted indices are dropped by an index filter — order-preserving,
 *      so multiple deletes shift correctly and duplicates / legitimate nulls
 *      are safe (never value-matched like `$pull`).
 * The rebuilt array is emitted as `$set[parentPath]`; consumed `$set`/`$unset`
 * ops are removed. Object numeric-string keys stay `$unset` (parent not Array).
 * Mutates `setOps` / `unsetOps` in place.
 *
 * ponytail: overlapping array subtrees (one delete path an ancestor of another,
 * e.g. `tags[0]` AND `tags[2].sub[0]` in one commit) are left as `$unset` for
 * BOTH — a per-array splice can't compose across the shift the outer delete
 * introduces, and the fallback never corrupts a sibling element. Upgrade to a
 * whole-column rebuild (à la applyTreeEdits) only if that combo is ever reported.
 */
function applyArrayElementRemovals(
  rawDoc: Record<string, unknown>,
  setOps: Record<string, unknown>,
  unsetOps: Record<string, unknown>,
): void {
  const arrays = new Map<string, Set<number>>();
  for (const path of Object.keys(unsetOps)) {
    const dot = path.lastIndexOf(".");
    if (dot < 0) continue; // top-level column delete — never an array element
    const last = path.slice(dot + 1);
    if (!/^\d+$/.test(last)) continue;
    const parentPath = path.slice(0, dot);
    if (!Array.isArray(rawValueAtPath(rawDoc, parentPath))) continue;
    let indices = arrays.get(parentPath);
    if (!indices) {
      indices = new Set();
      arrays.set(parentPath, indices);
    }
    indices.add(Number.parseInt(last, 10));
  }
  if (arrays.size === 0) return;

  const paths = [...arrays.keys()];
  const overlapping = new Set<string>();
  for (const a of paths) {
    for (const b of paths) {
      if (a !== b && (a.startsWith(`${b}.`) || b.startsWith(`${a}.`))) {
        overlapping.add(a);
      }
    }
  }

  for (const [parentPath, indices] of arrays) {
    if (overlapping.has(parentPath)) continue;
    const original = rawValueAtPath(rawDoc, parentPath) as unknown[];
    const rebuilt = structuredClone(original);
    const prefix = `${parentPath}.`;
    for (const setPath of Object.keys(setOps)) {
      if (!setPath.startsWith(prefix)) continue;
      deepSetField(
        rebuilt as unknown as object,
        setPath.slice(prefix.length),
        setOps[setPath],
      );
      delete setOps[setPath];
    }
    setOps[parentPath] = rebuilt.filter((_, i) => !indices.has(i));
    for (const i of indices) delete unsetOps[`${parentPath}.${i}`];
  }
}

/**
 * Collapse prefix-overlapping field paths in one document's patch so MongoDB
 * doesn't reject the update with WriteError code 40 — a single update can't
 * touch both a parent path and its child (`$set: { "tags.1": {…},
 * "tags.1.test": 3 }` → "Updating the path 'tags.1.test' would create a
 * conflict at 'tags.1'"; user report 2026-07-18). This overlap is legitimate:
 * the user added a container and filled it in one commit (`a`={} → `a.b`=3, or
 * a new array element `tags[1]` → `tags[1].test`), so no edit may be dropped.
 *
 * Fold every descendant into its nearest ancestor already in the patch,
 * shallowest-first so an ancestor is resolved before its descendants:
 *   - ancestor `$set` (object/array) absorbs the descendant — a `$set` child
 *     deep-sets into the parent value, a `$unset` child deep-deletes from it;
 *     only the ancestor path is emitted, preserving the parent's other fields.
 *   - ancestor `$unset` removes the whole subtree, so its descendants are
 *     subsumed and dropped (the user deleted the parent).
 * Paths with no ancestor in the patch (`a.b` alone) pass through unchanged —
 * MongoDB creates the intermediate itself, which is not a conflict.
 */
function collapsePrefixConflicts(
  setOps: Record<string, unknown>,
  unsetOps: Record<string, unknown>,
): { setOps: Record<string, unknown>; unsetOps: Record<string, unknown> } {
  // Resolve shallowest-first so an ancestor is always placed before its
  // descendants; the emit pass below restores the original key order.
  const ordered = [
    ...Object.keys(setOps).map((path) => ({ path, kind: "set" as const })),
    ...Object.keys(unsetOps).map((path) => ({ path, kind: "unset" as const })),
  ].sort((a, b) => a.path.split(".").length - b.path.split(".").length);

  // Root paths surviving the collapse: `mergedSet` holds each `$set` root's
  // (possibly merged, cloned) value; `unsetRoots` holds each `$unset` root.
  const mergedSet = new Map<string, unknown>();
  const unsetRoots = new Set<string>();
  const cloned = new Set<string>();
  const isAncestor = (anc: string, path: string) => path.startsWith(`${anc}.`);
  // ponytail: O(n²) ancestor scan — patch cells per document are few; upgrade
  // to a prefix trie only if a single doc ever carries thousands of edits.
  const findAncestor = (roots: Iterable<string>, path: string) => {
    for (const root of roots) if (isAncestor(root, path)) return root;
    return undefined;
  };

  for (const { path, kind } of ordered) {
    // An $unset ancestor removes the whole subtree → this edit is subsumed.
    if (findAncestor(unsetRoots, path) !== undefined) continue;

    const setAnc = findAncestor(mergedSet.keys(), path);
    if (setAnc !== undefined) {
      // Clone the parent value once before mutating so we never write back
      // into the caller's pendingEdits objects.
      if (!cloned.has(setAnc)) {
        const base = mergedSet.get(setAnc);
        mergedSet.set(
          setAnc,
          typeof base === "object" && base !== null
            ? structuredClone(base)
            : base,
        );
        cloned.add(setAnc);
      }
      const container = mergedSet.get(setAnc);
      // ponytail: a scalar/null parent can't hold a nested field. The tree
      // only nests keys under object/array elements, so this is UI-unreachable;
      // the explicit whole-element replacement wins and the child is dropped.
      if (typeof container === "object" && container !== null) {
        const sub = path.slice(setAnc.length + 1);
        if (kind === "set") deepSetField(container, sub, setOps[path]);
        else deepDeleteField(container, sub);
      }
      continue;
    }

    if (kind === "set") mergedSet.set(path, setOps[path]);
    else unsetRoots.add(path);
  }

  // Emit in the original insertion order (only surviving root paths).
  const outSet: Record<string, unknown> = {};
  for (const key of Object.keys(setOps)) {
    if (mergedSet.has(key)) outSet[key] = mergedSet.get(key);
  }
  const outUnset: Record<string, unknown> = {};
  for (const key of Object.keys(unsetOps)) {
    if (unsetRoots.has(key)) outUnset[key] = unsetOps[key];
  }
  return { setOps: outSet, unsetOps: outUnset };
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
  row: readonly unknown[],
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
    editRowSnapshots,
    deletedRowSnapshots,
    rawDocuments,
  } = input;

  const errors: MqlGenerationError[] = [];
  const insertLines: string[] = [];
  const insertCommands: MqlCommand[] = [];
  const insertSources: MqlCommandSource[] = [];
  const updateLines: string[] = [];
  const updateCommands: MqlCommand[] = [];
  const updateSources: MqlCommandSource[] = [];
  const deleteLines: string[] = [];
  const deleteCommands: MqlCommand[] = [];
  const deleteSources: MqlCommandSource[] = [];

  // ── Update path ─────────────────────────────────────────────────────────
  // Issue #1081 — group pending edits by the row-identity ANCHOR captured at
  // edit time (keyed by the cell key `${rowIdx}-${colIdx}`), falling back to
  // the current page's row. Grouping by the resolved `_id` — NOT the visual
  // rowIdx — means a cross-page edit on the same row index but a different
  // column emits its own updateOne against its own document, instead of
  // merging two documents' fields into one wrong-`_id` patch.
  // Sprint 322 — Slice F.2: `column` 은 dot-path 가 포함된 patch
  // field path (예: `meta.verified`). top-level edit 는 path === null
  // → bare column name. nested edit (path !== null) 는 sentinel-edit
  // guard 와 `_id`-in-patch guard 의 대상이 아님 (sentinel column
  // 자체는 read-only 지만, 그 안의 1-depth scalar 는 dot-notation
  // `$set` 으로 update 가능).
  interface DocEditGroup {
    rowIdx: number;
    row: readonly unknown[] | undefined;
    // `key` — the full pendingEdits key (issue #1440: partial-commit prune
    // maps an applied updateOne back to the pending entries it consumed).
    cells: Array<{
      key: string;
      column: string;
      value: unknown;
      nested: boolean;
    }>;
  }
  const editsByDoc = new Map<string, DocEditGroup>();
  pendingEdits.forEach((value, key) => {
    const parsed = parseEditKey(key);
    if (parsed === null) return;
    const [rowIdx, colIdx, path] = parsed;
    const col = columns[colIdx];
    if (!col) return;
    const baseKey = `${rowIdx}-${colIdx}`;
    const anchorRow = editRowSnapshots?.get(baseKey) ?? rows[rowIdx];
    // Group key: the resolved `_id` keeps all cells of one document in a
    // single updateOne. When the anchor has no derivable `_id` we key by
    // rowIdx so the missing-id error still fires once per row.
    let groupKey: string;
    if (!anchorRow) {
      groupKey = `__norow-${rowIdx}`;
    } else {
      const anchorId = documentIdFromRow(rowToRecord(anchorRow, columns));
      groupKey = anchorId
        ? `id:${formatDocumentIdForMql(anchorId)}`
        : `__noid-${rowIdx}`;
    }
    const fieldPath =
      path !== null ? toMongoFieldPath(col.name, path) : col.name;
    const entry = { key, column: fieldPath, value, nested: path !== null };
    const existing = editsByDoc.get(groupKey);
    if (existing) {
      existing.cells.push(entry);
    } else {
      editsByDoc.set(groupKey, { rowIdx, row: anchorRow, cells: [entry] });
    }
  });

  // Sprint 324 — Slice G.2: pendingEdits Map type 은 string|null 이므로
  // BSON wrapper 는 caller (DocumentDataGrid) 가 `__bson__:` prefix 의
  // 직렬화 string 으로 보관. 여기서 prefix detect 시 parse 해서 wrapper
  // 객체로 복원 → mongosh literal (`ObjectId("...")`) 로 출력된다.
  // user report 2026-07-18 — `tagBsonWrapper` 는 non-string 값 (BSON wrapper
  // object AND 트리 `+ key` 스칼라) 을 모두 JSON 으로 직렬화하므로 언랩도
  // 대칭이어야 한다: object 뿐 아니라 parse 된 어떤 값 (number/boolean/null)
  // 도 복원. object-only 가드는 스칼라를 리터럴 `"__bson__:3"` 문자열로
  // 커밋해 WriteError 를 유발했다.
  editsByDoc.forEach(({ cells }) => {
    for (const cell of cells) {
      if (
        typeof cell.value === "string" &&
        cell.value.startsWith("__bson__:")
      ) {
        try {
          cell.value = JSON.parse(cell.value.slice("__bson__:".length));
        } catch {
          // leave as-is; downstream renders the raw tag string.
        }
      }
    }
  });
  editsByDoc.forEach(({ rowIdx, row, cells }) => {
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

    // Sprint 342 V2 — split cells into $set vs $unset by sentinel.
    // The `__op__:unset` sentinel is owned by DocumentTreePanel's delete
    // action; it's a string so the existing pendingEdits Map type stays
    // unchanged (string | object).
    const rawSetOps: Record<string, unknown> = {};
    const rawUnsetOps: Record<string, unknown> = {};
    for (const { column, value } of cells) {
      if (value === "__op__:unset") {
        rawUnsetOps[column] = "";
      } else {
        rawSetOps[column] = value;
      }
    }
    // Issue #1704 — an array-element delete must SPLICE (real removal + index
    // shift), not `$unset` (which nulls the slot). Only when `rawDocuments`
    // gives the current page's document AND its `_id` matches this group's id
    // (so a stale/cross-page raw doc can never seed the wrong array) do we read
    // the array's real shape and rebuild it into a whole-array `$set`.
    const rawDoc = rawDocuments?.[rowIdx];
    if (rawDoc !== undefined && sameDocumentId(documentIdFromRow(rawDoc), id)) {
      applyArrayElementRemovals(rawDoc, rawSetOps, rawUnsetOps);
    }
    // Sprint (user report 2026-07-18) — fold parent/child prefix overlaps so a
    // container add + fill in one commit (`a`={} → `a.b`=3, `tags.1` →
    // `tags.1.test`) doesn't emit both paths and trip WriteError code 40. Both
    // the executed patch and the preview string derive from these, so the
    // preview==execute invariant holds.
    const { setOps, unsetOps } = collapsePrefixConflicts(
      rawSetOps,
      rawUnsetOps,
    );
    // Empty patch (all edits resolved back to original values upstream)
    // should never happen because `useDataGridEdit` already prunes those,
    // but we guard defensively — generating `updateOne({_id}, {$set: {}})`
    // is a server-side no-op that still costs a roundtrip.
    if (
      Object.keys(setOps).length === 0 &&
      Object.keys(unsetOps).length === 0
    ) {
      return;
    }

    const patch: Record<string, unknown> = {};
    if (Object.keys(setOps).length > 0) patch.$set = setOps;
    if (Object.keys(unsetOps).length > 0) patch.$unset = unsetOps;

    const filterLiteral = `{ _id: ${formatDocumentIdForMql(id)} }`;
    const patchParts: string[] = [];
    if (Object.keys(setOps).length > 0) {
      patchParts.push(`$set: ${formatMqlObject(setOps)}`);
    }
    if (Object.keys(unsetOps).length > 0) {
      patchParts.push(`$unset: ${formatMqlObject(unsetOps)}`);
    }
    const patchLiteral = `{ ${patchParts.join(", ")} }`;
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
    updateSources.push({ kind: "update", editKeys: cells.map((c) => c.key) });
  });

  // ── Delete path ─────────────────────────────────────────────────────────
  pendingDeletedRowKeys.forEach((delKey) => {
    const rowIdx = parseDeleteKey(delKey);
    if (rowIdx === null) return;
    // Issue #1081 — anchor the `_id` filter to the row captured at delete time.
    const row = deletedRowSnapshots?.get(delKey) ?? rows[rowIdx];
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
    deleteSources.push({ kind: "delete", deleteKey: delKey });
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
    insertSources.push({ kind: "insert", newRowIndex: rowIdx });
  });

  return {
    previewLines: [...insertLines, ...updateLines, ...deleteLines],
    commands: [...insertCommands, ...updateCommands, ...deleteCommands],
    sources: [...insertSources, ...updateSources, ...deleteSources],
    errors,
  };
}
