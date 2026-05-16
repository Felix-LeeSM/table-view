// Sprint 361 (Phase 3, Q13) — per-connection workspace window launcher.
//
// Frontend `invoke` wrapper around `open_workspace_window(connection_id)`.
// The backend (`src-tauri/src/commands/open_workspace_window.rs`) is the
// single source of truth for the per-conn `workspace-{connection_id}`
// label and the idempotent focus-vs-create branch.
//
// Callers (sprint-362's single-instance plugin shim, sprint-363's
// connection dispatch UI, etc.) only pass a `connectionId`; the
// label format / window geometry live in Rust.

import { invoke } from "@tauri-apps/api/core";

/**
 * Open (or focus) the workspace window for `connectionId`.
 *
 * Per Q13 of the state-management strategy (sprint-361):
 *   - First call with a given `connectionId` builds a new window with the
 *     label `workspace-{connectionId}`.
 *   - Subsequent calls with the SAME `connectionId` focus the existing
 *     window; no second window is spawned (idempotent).
 *   - Different `connectionId` values each get their own window — multiple
 *     workspace windows can coexist (TablePlus pattern).
 *
 * Rejects with the wrapped `AppError` string when the backend refuses
 * (e.g. validation: empty `connectionId`).
 */
export async function openWorkspaceWindow(connectionId: string): Promise<void> {
  await invoke<void>("open_workspace_window", { connectionId });
}
