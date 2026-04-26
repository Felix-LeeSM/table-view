/**
 * Sprint 130 — paradigm-aware "switch active database" wrapper.
 *
 * Thin Tauri bridge for the `switch_active_db(connection_id, db_name)` command
 * (`src-tauri/src/commands/meta.rs`). PG swaps the active sub-pool to
 * `dbName`; SQLite/MySQL/Search/Kv currently surface `AppError::Unsupported`
 * via the trait default, and Document paradigm is intentionally `Unsupported`
 * until Sprint 131 lands `use_db`.
 *
 * Mirrors the `listDatabases` thin-wrapper pattern — keeps a single point of
 * call so future paradigm dispatch changes (Phase 9) only touch one file.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * Activate `dbName` on the connection identified by `connectionId`.
 *
 * Resolves with `void` when the backend successfully flipped the active
 * sub-pool. Rejects with the serialised `AppError`:
 *   - `NotFound`     — connection id has no live adapter
 *   - `Validation`   — empty `dbName`
 *   - `Connection`   — adapter never connected, or the lazy pool open failed
 *   - `Unsupported`  — paradigm doesn't (yet) support DB switching
 *
 * The DbSwitcher UI converts each rejection into a user-facing toast so
 * the frontend doesn't need to branch on the error variant.
 */
export async function switchActiveDb(
  connectionId: string,
  dbName: string,
): Promise<void> {
  return invoke<void>("switch_active_db", { connectionId, dbName });
}
