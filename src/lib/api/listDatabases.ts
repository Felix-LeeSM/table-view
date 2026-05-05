/**
 * Paradigm-neutral database list wrapper. Thin Tauri bridge for the
 * unified `list_databases(connection_id)` command. Returns:
 *   - PG: every non-template entry from `pg_database`
 *   - Mongo: every database visible to the user
 *   - Search / Kv: empty list (the backend returns rather than throws)
 *
 * Reuses `DatabaseInfo` from `@/types/document` since the wire shape
 * matches what `list_mongo_databases` already emits.
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
