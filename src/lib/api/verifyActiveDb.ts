/**
 * Sprint 132 — read the backend's view of the active database.
 *
 * Thin Tauri bridge for the `verify_active_db(connection_id)` command
 * (`src-tauri/src/commands/meta.rs`). Used by `QueryTab` immediately after
 * a raw query that triggered an optimistic `setActiveDb` (e.g. PG `\c foo`)
 * to confirm the backend's pool actually flipped. A mismatch between the
 * optimistic value and the verified value triggers a `toast.warn` + revert.
 *
 * Returns the empty string when the paradigm has a notion of "current DB"
 * but the adapter is unset (Mongo with no default). The frontend treats
 * the empty string as "could not verify" and skips the mismatch toast.
 *
 * Mirrors the `switchActiveDb` thin-wrapper pattern so frontend dispatch
 * stays paradigm-agnostic — callers don't branch on PG vs Mongo here.
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
