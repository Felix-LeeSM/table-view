/**
 * `import_legacy_localstorage` IPC frontend wrapper.
 *
 * Strategy line 1140–1180: on first boot the frontend reads the 5 LS
 * keys, normalizes them, and sends them to the backend through this
 * wrapper. The backend performs a one-time SQLite import and manages the
 * `meta.legacy_imported` 4-state transition (idempotent).
 *
 * This wrapper wires only the `favorites` / `mru` domains — the rest
 * (workspaces / theme / safeMode) were added later.
 *
 * The caller is responsible for:
 *   1. Parsing / normalizing each LS key's raw shape.
 *   2. Building the dehydrated camelCase payload.
 *   3. Not deleting the LS keys right after the call (cleanup happens in
 *      the W3 entry step).
 *
 * The backend is idempotent, so sending the payload twice is safe.
 */

import { invoke } from "@tauri-apps/api/core";

export interface LegacyFavorite {
  id: string;
  name: string;
  sql: string;
  /** `null` or omitted → backend column NULL — global favorite. */
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LegacyMruEntry {
  connectionId: string;
  /** Unix ms — value of `Date.now()` at call time. */
  lastUsed: number;
}

export interface LegacyPayload {
  favorites?: LegacyFavorite[];
  mru?: LegacyMruEntry[];
}

/**
 * Send the legacy LS payload to the backend.
 *
 * - On the first call `meta.legacy_imported` moves pending → importing → done.
 * - If already done, the backend returns a no-op (call cost ~ IPC overhead).
 * - On failure the backend sets the state to failed + throws — the caller
 *   enters safe mode or asks the user to retry.
 */
export async function importLegacyLocalStorage(
  payload: LegacyPayload,
): Promise<void> {
  await invoke<void>("import_legacy_localstorage", { payload });
}
