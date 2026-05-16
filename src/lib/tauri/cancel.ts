// Sprint 359 (Phase 2 Q5.3 / Q5.5) — paradigm-native cancel wrappers.
//
// Frontend currently fires `cancelQuery(queryId)` (legacy cooperative
// CancellationToken). That stops the in-process executor but does NOT
// abort the actual statement against the server. The new
// `cancelQueryNative(connectionId, serverPid)` IPC routes through
// `DbAdapter::cancel_query`:
//
//   * PG    → `SELECT pg_cancel_backend(<pid>)` on a side connection.
//   * MySQL → `KILL QUERY <thread_id>` on a side connection.
//   * Mongo → `db.adminCommand({killOp: 1, op: <opid>})`.
//
// Failures are classified into three buckets (Q5.5) so the caller can
// decide between silent suppression and a toast:
//
//   * AlreadyCompleted → silent (query already finished — common race).
//   * PermissionDenied → toast (privilege error from the server).
//   * NetworkError     → toast (driver / TCP fault).
//
// The wire shape is a JSON object embedded in `AppError::Database`'s
// string surface. We parse it here so callers see a typed discriminator.

import { invoke } from "@tauri-apps/api/core";

export type CancelError =
  | { type: "AlreadyCompleted" }
  | { type: "PermissionDenied"; message: string }
  | { type: "NetworkError"; message: string };

const DB_ERROR_PREFIX = "Database error: ";

/// Parse the backend's wire-encoded `CancelError`.
///
/// The backend wraps the JSON inside `AppError::Database(json)` so the
/// existing Tauri error channel can deliver it. We strip the prefix and
/// parse — falling back to `NetworkError` when the message isn't JSON
/// (e.g. legacy error path).
export function parseCancelError(raw: unknown): CancelError {
  const text = typeof raw === "string" ? raw : String(raw);
  const stripped = text.startsWith(DB_ERROR_PREFIX)
    ? text.slice(DB_ERROR_PREFIX.length)
    : text;
  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof (parsed as { type: unknown }).type === "string"
    ) {
      const type = (parsed as { type: string }).type;
      if (type === "AlreadyCompleted") {
        return { type: "AlreadyCompleted" };
      }
      if (type === "PermissionDenied") {
        const message = (parsed as { message?: unknown }).message;
        return {
          type: "PermissionDenied",
          message: typeof message === "string" ? message : "",
        };
      }
      if (type === "NetworkError") {
        const message = (parsed as { message?: unknown }).message;
        return {
          type: "NetworkError",
          message: typeof message === "string" ? message : "",
        };
      }
    }
  } catch {
    // JSON parse failure — wire shape changed or legacy plain-text
    // error. Fall through to the NetworkError default below.
  }
  return { type: "NetworkError", message: text };
}

/// Fire a paradigm-native cancel against the server pid recorded in
/// `AppState.tab_affinity`. Resolves on success. Rejects with a typed
/// `CancelError` so callers can branch on the discriminator.
///
/// Mongo callers pass the opid (materialised by the runner mid-query)
/// in the `serverPid` slot — the IPC signature is paradigm-agnostic.
export async function cancelQueryNative(
  connectionId: string,
  serverPid: number,
): Promise<void> {
  try {
    await invoke<void>("cancel_query_native", {
      connectionId,
      serverPid,
    });
  } catch (err) {
    throw parseCancelError(err);
  }
}

/// Tab-close hook: drop the affinity record + (future) ROLLBACK any
/// in-flight transaction. Idempotent — silent no-op when the tab never
/// recorded a server pid (Q5.6 lazy: idle tab).
export async function releaseTabConnection(
  connectionId: string,
  tabId: string,
): Promise<boolean> {
  return invoke<boolean>("release_tab_connection", {
    connectionId,
    tabId,
  });
}
