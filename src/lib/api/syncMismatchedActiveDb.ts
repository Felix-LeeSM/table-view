import { verifyActiveDb } from "@lib/api/verifyActiveDb";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";

/**
 * Sprint 267 / 269 — DbMismatch recovery helper, extracted to its own
 * module in Sprint 271a so background introspection paths (schemaStore)
 * can share it with the existing query-execution catch site without
 * duplicating the verify + sync logic.
 *
 * When backend rejects with `AppError::DbMismatch` (the Sprint 266 guard
 * has detected that the connection pool's active db diverged from what
 * the frontend tab requested), pull the backend's actual db via
 * `verifyActiveDb` and sync the frontend stores so the user's next click
 * dispatches against the correct `expectedDatabase`. Fire-and-forget —
 * verify failures stay invisible so callers never turn a single
 * DbMismatch into a second user-facing failure on top of the first.
 *
 * Toast surfaces are caller-controlled (`onSynced`):
 *   - user-initiated DDL / data fetch paths fire the Sprint 269 Retry
 *     toast inside `onSynced`.
 *   - background introspection (schemaStore prefetch, autocomplete
 *     refresh) leaves `onSynced` undefined and stays silent (Sprint 271a
 *     out-of-scope #5 — sync-only, no toast).
 *
 * `onSynced` is only invoked when verify resolved with a non-empty
 * `actual` db — preserves the Sprint 267 "verify-failed = silent"
 * invariant.
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
