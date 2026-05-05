/**
 * Read the backend's view of the active database. Thin Tauri bridge for
 * `verify_active_db(connection_id)`. Used by `QueryTab` after a raw
 * query that triggered an optimistic `setActiveDb` (e.g. PG `\c foo`)
 * to confirm the pool actually flipped — a mismatch surfaces a warn
 * toast and reverts the store.
 *
 * Returns `""` when the adapter has no current DB (Mongo with no
 * default); the frontend treats `""` as "could not verify" and skips
 * the mismatch toast.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Resolve the backend's active database name for `connectionId`.
 *
 * Resolves with the database name the active adapter currently sees:
 *   - Rdb       → result of `SELECT current_database()` (PG)
 *   - Document  → `MongoAdapter::current_active_db()` (or `""` when unset)
 *   - Search/Kv → rejects with `AppError::Unsupported`
 *
 * Rejects with the serialised `AppError`:
 *   - `NotFound`     — connection id has no live adapter
 *   - `Unsupported`  — paradigm has no per-connection database concept
 *   - `Database`     — verify query failed (PG) — caller should treat as
 *                       "could not verify" rather than overwriting state
 */
export async function verifyActiveDb(connectionId: string): Promise<string> {
  return invoke<string>("verify_active_db", { connectionId });
}
