/**
 * Document paradigm — frontend mutate wire types.
 *
 * These mirror the Rust `DocumentId` enum (`src-tauri/src/db/mod.rs`) and the
 * mutate Tauri commands (`src-tauri/src/commands/document/mutate.rs`). The
 * Rust enum uses the default `#[derive(Serialize, Deserialize)]` with no tag
 * attribute, so serde produces an **externally tagged** JSON encoding:
 *
 * - `DocumentId::ObjectId("507f…")` → `{"ObjectId": "507f…"}`
 * - `DocumentId::String("key")`      → `{"String": "key"}`
 * - `DocumentId::Number(42)`         → `{"Number": 42}`
 * - `DocumentId::Raw(<bson>)`        → `{"Raw": <canonical extended JSON>}`
 *
 * The TypeScript mirror below matches that wire format exactly so a
 * `DocumentId` value can be passed directly to Tauri `invoke` without any
 * remapping layer.
 *
 * Helper functions:
 * - {@link parseObjectIdLiteral} — recognise canonical EJSON `{"$oid":…}`
 *   wrappers and lift them into a `DocumentId.ObjectId`.
 * - {@link documentIdFromRow} — extract a `DocumentId` from a DataGrid row's
 *   `_id` column (handles EJSON wrappers, plain hex strings, numbers, and
 *   the fallback `Raw` case).
 * - {@link formatDocumentIdForMql} — render a `DocumentId` into the mongosh
 *   syntax used in MQL preview strings (e.g. `ObjectId("…")`).
 */

/**
 * Tagged union mirroring Rust `enum DocumentId`. Each variant carries a
 * single-field object whose key matches the Rust variant name — this is the
 * externally-tagged shape serde emits by default.
 *
 * Soundness: `ObjectId`/`String`/`Number` variants have concrete primitive
 * values; `Raw` is `unknown` because it is a canonical extended JSON payload
 * that can be any BSON shape the three well-typed variants cannot express.
 */
export type DocumentId =
  | { ObjectId: string }
  | { String: string }
  | { Number: number }
  | { Raw: unknown };

/**
 * Kind discriminator for a {@link DocumentId}. Callers that prefer
 * `switch (kindOfDocumentId(id))` over checking `"ObjectId" in id` should
 * route through this helper — it guarantees exhaustiveness via the `never`
 * branch.
 */
export type DocumentIdKind = "ObjectId" | "String" | "Number" | "Raw";

export function kindOfDocumentId(id: DocumentId): DocumentIdKind {
  if ("ObjectId" in id) return "ObjectId";
  if ("String" in id) return "String";
  if ("Number" in id) return "Number";
  return "Raw";
}

/** 24-character lowercase-or-uppercase hex → a valid Mongo ObjectId. */
const OBJECT_ID_HEX_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Try to lift a canonical-extended-JSON `ObjectId` wrapper into a
 * {@link DocumentId}. Accepts shapes the MongoDB driver emits when it
 * serialises a BSON `ObjectId` through serde (`{ "$oid": "<hex>" }`). Returns
 * `null` for anything else — including `{ "$oid": "not-hex" }` so callers can
 * surface the failure rather than silently round-tripping a bogus id.
 */
export function parseObjectIdLiteral(value: unknown): DocumentId | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const oid = record["$oid"];
  if (typeof oid !== "string") return null;
  if (!OBJECT_ID_HEX_RE.test(oid)) return null;
  return { ObjectId: oid };
}

/**
 * Extract a {@link DocumentId} from a grid row's `_id` column. Handles the
 * three well-typed shapes the backend round-trips through canonical extended
 * JSON:
 *
 * - `{ "$oid": "<hex>" }`           → `{ ObjectId: "<hex>" }`
 * - plain 24-hex `string`            → `{ ObjectId: "<hex>" }`
 * - any other non-empty `string`     → `{ String: <s> }`
 * - finite `number`                  → `{ Number: <n> }`
 *
 * Returns `null` when `_id` is absent, nullish, or a shape the helper does
 * not know how to promote to a typed variant (the caller should treat this
 * as a `missing-id` error). Composite `_id` values (documents, arrays, BSON
 * binaries, etc.) intentionally fall through — editing those rows is not
 * supported, and the generator surfaces a `missing-id` error for them.
 */
export function documentIdFromRow(
  row: Record<string, unknown>,
): DocumentId | null {
  if (!Object.prototype.hasOwnProperty.call(row, "_id")) return null;
  const raw = row["_id"];
  if (raw === null || raw === undefined) return null;

  // Canonical EJSON `{ "$oid": "<hex>" }` wrapper.
  const fromOid = parseObjectIdLiteral(raw);
  if (fromOid !== null) return fromOid;

  if (typeof raw === "string") {
    if (raw.length === 0) return null;
    if (OBJECT_ID_HEX_RE.test(raw)) return { ObjectId: raw };
    return { String: raw };
  }

  if (typeof raw === "number" && Number.isFinite(raw)) {
    return { Number: raw };
  }

  // Bigint is out of JS JSON scope; composite values fall through.
  return null;
}

/** Escape characters that would break a JS double-quoted string literal. */
function escapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Render a {@link DocumentId} into the mongosh literal syntax used in MQL
 * preview strings:
 *
 * - `ObjectId` → `ObjectId("<hex>")`
 * - `String`   → `"<escaped>"`
 * - `Number`   → `<n>` (unquoted)
 * - `Raw`      → `JSON.stringify(value)` (compact) — the preview is a best-
 *   effort display only; we do not reverse-engineer composite BSON back
 *   into mongosh syntax.
 */
export function formatDocumentIdForMql(id: DocumentId): string {
  if ("ObjectId" in id) return `ObjectId("${id.ObjectId}")`;
  if ("String" in id) return `"${escapeDoubleQuoted(id.String)}"`;
  if ("Number" in id) return String(id.Number);
  return JSON.stringify(id.Raw);
}

// ── Sprint 308 (2026-05-14) — bulkWrite wire types ─────────────────────────
//
// 작성 이유: A1 mongosh 파서가 `db.coll.bulkWrite([...])` 를 dispatch 했을
// 때 reify 한 sub-op 배열을 그대로 IPC payload 로 보내고, 결과 카운터를
// `WriteSummaryPanel` 이 per-op breakdown 으로 렌더링한다. Rust 측 `enum
// BulkWriteOp` 는 `#[serde(tag = "op", rename_all = "camelCase")]` 로
// camelCase wire tag (`"insertOne"` / `"updateOne"` / …) 를 emit 한다.

/**
 * `bulkWrite` sub-operation. Discriminated union mirrors Rust `enum
 * BulkWriteOp` with serde `tag = "op", rename_all = "camelCase"`. Wire
 * JSON example:
 *
 *     { "op": "updateOne", "filter": {...}, "update": {...}, "upsert": false }
 *
 * `upsert` is optional in the wire shape (serde `#[serde(default)]`); the
 * TS mirror keeps it optional for the same reason.
 */
export type BulkWriteOp =
  | { op: "insertOne"; document: Record<string, unknown> }
  | {
      op: "updateOne";
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      upsert?: boolean;
    }
  | {
      op: "updateMany";
      filter: Record<string, unknown>;
      update: Record<string, unknown>;
      upsert?: boolean;
    }
  | { op: "deleteOne"; filter: Record<string, unknown> }
  | { op: "deleteMany"; filter: Record<string, unknown> }
  | {
      op: "replaceOne";
      filter: Record<string, unknown>;
      replacement: Record<string, unknown>;
      upsert?: boolean;
    };

/**
 * Aggregate counters returned by `bulkWrite`. The Rust struct uses default
 * (snake_case) serde — matching the existing `DocumentQueryResult.total_count`
 * convention — so the wire field names stay snake_case here.
 *
 * `upserted_ids` carries the server-side `_id` for every upsert-mode
 * update/replace that actually inserted (skipped when the matching filter
 * found an existing doc).
 */
export interface BulkWriteResult {
  inserted_count: number;
  matched_count: number;
  modified_count: number;
  deleted_count: number;
  upserted_ids: DocumentId[];
}
