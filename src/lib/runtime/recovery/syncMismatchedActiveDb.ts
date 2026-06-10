import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { getDbMismatchInfo } from "@lib/tauri/error";
import { useConnectionStore } from "@stores/connectionStore";
import {
  registerSchemaDbMismatchRecoveryHandler,
  useSchemaStore,
} from "@stores/schemaStore";

let schemaStoreRecoveryRegistered = false;

/**
 * DbMismatch recovery is a runtime concern: verify the backend's actual
 * active db, sync frontend stores, and let callers decide whether a toast
 * should be shown.
 *
 * Background introspection leaves `onSynced` undefined and stays silent.
 * User-initiated query/DDL/data paths can attach Retry toasts in `onSynced`.
 * Verify failures stay invisible so one DbMismatch never turns into a second
 * user-facing failure.
 */
export async function syncMismatchedActiveDb(
  connectionId: string,
  onSynced?: (actual: string) => void,
): Promise<void> {
  try {
    const actual = await verifyActiveDb(connectionId);
    if (!actual) return;
    useConnectionStore.getState().setActiveDb(connectionId, actual);
    useSchemaStore.getState().clearForConnection(connectionId);
    onSynced?.(actual);
  } catch {
    // Best-effort — verify failure must not turn into a second user-facing
    // failure on top of the original DbMismatch. The Retry toast is NOT
    // surfaced when verify rejects: a Retry whose first action would race
    // an unsynced backend would just re-trigger the same DbMismatch.
  }
}

/**
 * Wire schemaStore's background introspection mismatch signal to the shared
 * runtime recovery use-case. Kept outside schemaStore to avoid a store ->
 * runtime -> same store import cycle.
 */
export function registerSchemaStoreDbMismatchRecovery(): void {
  if (schemaStoreRecoveryRegistered) return;
  schemaStoreRecoveryRegistered = true;
  registerSchemaDbMismatchRecoveryHandler((connectionId, err) => {
    if (getDbMismatchInfo(err)) {
      void syncMismatchedActiveDb(connectionId);
    }
  });
}

export function resetSchemaStoreDbMismatchRecoveryForTests(): void {
  schemaStoreRecoveryRegistered = false;
  registerSchemaDbMismatchRecoveryHandler(null);
}
