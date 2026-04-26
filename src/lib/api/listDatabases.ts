/**
 * Sprint 128 — paradigm-neutral database list wrapper.
 *
 * Thin Tauri bridge for the unified `list_databases(connection_id)` command
 * (`src-tauri/src/commands/meta.rs`). Returns the list of databases the
 * connected adapter exposes:
 *   - PG  → every non-template entry from `pg_database`
 *   - Mongo → every database visible to the user
 *   - Search/Kv → empty list (graceful — the backend doesn't throw)
 *
 * The wire shape mirrors `DatabaseInfo { name }` already emitted by the
 * Mongo-specific `list_mongo_databases`, so the frontend can keep using
 * `@/types/document::DatabaseInfo` for both code paths during the Sprint 128
 * → Sprint 130 migration window.
 *
 * Lives under `src/lib/api/` (sprint contract) so the new entry point doesn't
 * inflate the existing `src/lib/tauri.ts` barrel before Phase 9 paradigm
 * commands force a broader split.
 */
import { invoke } from "@tauri-apps/api/core";
import type { DatabaseInfo } from "@/types/document";

/**
 * Fetch the list of databases visible to `connectionId`'s active adapter.
 *
 * Resolves with an empty array when the paradigm has no per-connection
 * database concept (Search/Kv) — callers should treat this the same as a
 * legitimate "no databases" response and keep the read-only switcher chrome.
 *
 * Rejects with the serialised `AppError` when the connection id has no live
 * adapter (the backend surfaces `AppError::NotFound`) or when the underlying
 * driver fails for an unrelated reason.
 */
export async function listDatabases(
  connectionId: string,
): Promise<DatabaseInfo[]> {
  return invoke<DatabaseInfo[]>("list_databases", { connectionId });
}
