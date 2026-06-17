/**
 * Paradigm-aware "switch active database" wrapper. Thin Tauri bridge for
 * `switch_active_db(connection_id, db_name)`.
 *
 * RDB switch-capable adapters swap the active sub-pool/catalog. Redis/Valkey
 * parse `db_name` as a numeric DB index and run the KV adapter switch. Mongo
 * backend support exists below the product contract, but the frontend keeps
 * Mongo database scope tab-local through TabDbChip instead of this toolbar.
 * Search and fixed-scope profiles surface `AppError::Unsupported`.
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
 *   - `Unsupported`  — active adapter/profile keeps database scope fixed
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
