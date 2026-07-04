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
// The wire shape is `AppError::Cancel`, serialized as a typed top-level
// object. We parse only that envelope so ordinary database error strings
// that happen to contain JSON cannot be mistaken for cancel classifications.

import { invoke } from "@tauri-apps/api/core";

export type CancelError =
  | { type: "AlreadyCompleted" }
  | { type: "PermissionDenied"; message: string }
  | { type: "NetworkError"; message: string };

export function parseCancelError(raw: unknown): CancelError {
  const envelope = parseMaybeJson(raw);
  if (isRecord(envelope) && envelope.type === "Cancel") {
    const parsed = parseCancelPayload(envelope.payload);
    if (parsed) return parsed;
  }
  return { type: "NetworkError", message: stringifyUnknownError(raw) };
}

function parseCancelPayload(payload: unknown): CancelError | null {
  if (!isRecord(payload) || typeof payload.type !== "string") return null;
  if (payload.type === "AlreadyCompleted") return { type: "AlreadyCompleted" };
  if (payload.type === "PermissionDenied") {
    return {
      type: "PermissionDenied",
      message: typeof payload.message === "string" ? payload.message : "",
    };
  }
  if (payload.type === "NetworkError") {
    return {
      type: "NetworkError",
      message: typeof payload.message === "string" ? payload.message : "",
    };
  }
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringifyUnknownError(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value)) {
    if (typeof value.message === "string") return value.message;
    if (typeof value.payload === "string") return value.payload;
  }
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/// Fire a paradigm-native cancel. Resolves on success. Rejects with a typed
/// `CancelError` so callers can branch on the discriminator.
///
/// Two routes (the backend picks by presence of `queryId`):
///   * RDB — pass `serverPid` (pg backend pid / mysql thread id) captured at
///     executeQuery time via `getQueryServerPid` (Issue #1230).
///   * Mongo — pass `queryId` (Issue #1269). The opid is not client-visible,
///     so the backend resolves it via `$currentOp` matched on the tag the
///     runner stamped, then `killOp`s it. `serverPid` is ignored on this route
///     (pass `0`).
export async function cancelQueryNative(
  connectionId: string,
  serverPid: number,
  queryId?: string,
): Promise<void> {
  try {
    await invoke<void>("cancel_query_native", {
      connectionId,
      serverPid,
      queryId,
    });
  } catch (err) {
    throw parseCancelError(err);
  }
}

/// Issue #1230 — resolve the native server pid the backend captured for a
/// running query (keyed by the same `queryId` passed to `executeQuery`).
/// Returns the pid while the query is in flight, or `null` when the query
/// captured no pid (adapter without native cancel) or already finished. The
/// Cancel button feeds the pid to `cancelQueryNative`.
export async function getQueryServerPid(
  queryId: string,
): Promise<number | null> {
  return invoke<number | null>("get_query_server_pid", { queryId });
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
