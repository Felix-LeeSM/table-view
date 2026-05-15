import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  extractDbMutation,
  type SqlMutationDialect,
} from "@lib/sql/sqlDialectMutations";
import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { toast } from "@lib/toast";
import type { Paradigm } from "@/types/connection";
import type { QueryTab } from "@stores/workspaceStore";
import { documentIdFromRow, type DocumentId } from "@/types/documentMutate";

/**
 * `QueryTab` module-top helpers:
 *   - `readDocumentContext` reads `database`/`collection` for document
 *     tabs (Mongo find/aggregate Tauri commands fail without both).
 *   - `isRecord` / `isRecordArray` narrow JSON.parse output (find → object,
 *     aggregate → object[]).
 *   - `applyDbMutationHint` lexes a freshly-run SQL for `\c`/`USE`/
 *     `SET search_path`; on a hit it optimistically flips the active DB
 *     and round-trips `verify_active_db`. Fire-and-forget — never throws,
 *     so a verify failure cannot tear down the query result panel
 *     ("verify 실패 ≠ query 실패").
 */

export interface DocumentQueryContext {
  database: string;
  collection: string;
}

export function readDocumentContext(
  tab: QueryTab,
): DocumentQueryContext | null {
  if (!tab.database || !tab.collection) return null;
  return { database: tab.database, collection: tab.collection };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecordArray(
  value: unknown,
): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

/**
 * Sprint 312 (Phase 28 Slice A6, 2026-05-14) — extract a `_id`-only
 * filter (`{ _id: <value> }` with exactly one key) into a typed
 * `DocumentId`. Returns `null` when the filter is missing `_id`, has
 * additional keys, or when the `_id` value isn't promotable to a
 * `DocumentId` variant. The single-doc `updateDocument` / `deleteDocument`
 * IPCs only accept a `DocumentId`, so the dispatch table uses this to
 * choose between the fast single-IPC path and the D-16 bulkWrite
 * fallback for arbitrary filters.
 */
export function idOnlyFilter(
  filter: Record<string, unknown>,
): DocumentId | null {
  const keys = Object.keys(filter);
  if (keys.length !== 1 || keys[0] !== "_id") return null;
  return documentIdFromRow(filter);
}

/**
 * Sprint 312 — extract the `$set` clause out of an update document.
 * Returns `null` when the patch is malformed (not an object) or when
 * `$set` itself isn't a plain object. A6's dispatch table refuses
 * non-`$set` updates here (rather than at A2) so the editor surface
 * stays consistent with the existing `useMongoBulkOps` reject path.
 */
export function extractDollarSet(
  update: Record<string, unknown>,
): Record<string, unknown> | null {
  const value = update.$set;
  if (!isRecord(value)) return null;
  if ("_id" in value) return null;
  return value;
}

// After `await executeQuery(...)` we re-scan the SQL for dialect-specific
// DB/schema/Redis-index switches. A match optimistically flips
// `setActiveDb(targetDb)` so the toolbar/sidebar reflect the new context
// without a manual click, then round-trips `verify_active_db` and warns
// + reverts on mismatch.
//
// The hook never throws — verify failures stay invisible to the user so
// the query result panel survives a network blip. Document/kv/search
// paradigms short-circuit (Mongo has no `\c`/`USE` equivalent;
// kv/search don't reach `executeQuery`).
export async function applyDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
  setActiveDb: (id: string, dbName: string) => void,
  clearForConnection: (id: string) => void,
): Promise<void> {
  if (paradigm !== "rdb") return;
  // PG-only today. The lexer accepts MySQL/Redis dialects, but raw-SQL
  // routing in the UI is PG-only, so the dialect is hard-coded until a
  // future MySQL adapter resolves it from `tab.connectionMeta`.
  const dialect: SqlMutationDialect = "postgres";
  const hint = extractDbMutation(sql, dialect);
  if (!hint) return;

  try {
    if (hint.kind === "switch_database") {
      // Optimistic local update — toolbar trigger label and any reader of
      // `activeStatuses[id].activeDb` flips immediately.
      setActiveDb(connectionId, hint.targetDb);
      // Schema cache must be evicted before any sidebar refresh request
      // can race in with the old DB's tables.
      clearForConnection(connectionId);
      try {
        const actual = await verifyActiveDb(connectionId);
        // Empty string === "could not verify" (Mongo-side semantic borrowed
        // for symmetry); skip the mismatch toast.
        if (actual && actual !== hint.targetDb) {
          toast.warning(
            `Active DB mismatch: expected '${hint.targetDb}', got '${actual}'. Reverting.`,
          );
          setActiveDb(connectionId, actual);
        }
      } catch {
        // Verify is best-effort — a network blip must not tear down the
        // query result. "verify 실패 ≠ query 실패."
      }
    } else if (hint.kind === "switch_schema") {
      // Schema-level change — there's no cheap PG accessor to verify, so
      // we just evict the schema cache and surface an info toast.
      clearForConnection(connectionId);
      toast.info(`Active schema set to '${hint.targetSchema}'.`);
    } else if (hint.kind === "redis_select") {
      // Redis adapter not wired yet — acknowledge intent only.
      toast.info(`Redis SELECT ${hint.databaseIndex} acknowledged.`);
    }
  } catch {
    // Outer guard — the hook must never propagate to the user. Any
    // exception thrown by the store mutators or the extractor is treated
    // as a no-op.
  }
}

/**
 * Helper to dispatch `applyDbMutationHint` with the current store snapshot.
 * Single call site previously inlined twice in `handleExecute`; lifting it
 * here keeps the snapshot read pattern in one place so a future store
 * refactor doesn't need to touch the execution hook.
 */
export function dispatchDbMutationHint(
  connectionId: string,
  paradigm: Paradigm,
  sql: string,
): void {
  void applyDbMutationHint(
    connectionId,
    paradigm,
    sql,
    useConnectionStore.getState().setActiveDb,
    useSchemaStore.getState().clearForConnection,
  );
}
