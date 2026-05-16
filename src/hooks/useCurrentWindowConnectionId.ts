/**
 * Sprint 366 (Phase 4, Q15) — Resolve the connection id implied by the
 * current Tauri webview window's label.
 *
 * Background: pre-sprint-361 every workspace window shared the bare
 * `"workspace"` label and the "which connection am I looking at?" question
 * was answered by `connectionStore.focusedConnId`. Sprint 361 made
 * workspace labels per-connection (`workspace-{connection_id}`); from this
 * sprint on the workspace tree derives its connection identity from the
 * window label rather than from the cross-window store slot — that's the
 * Q15 lock in `docs/state-management-strategy-2026-05-15.md`. The
 * `focusedConnId` slot is now launcher-only.
 *
 * Behaviour:
 *   - `"launcher"` (or `null` when Tauri isn't wired up) → `null`.
 *   - `"workspace-{id}"` → `id`.
 *   - Anything else (legacy `"workspace"`, `"workspace-"`, unknown) →
 *     `null`.
 *
 * The result is computed once at mount via `useMemo` keyed on the raw
 * label string. Window labels never change for the lifetime of a Tauri
 * webview (a new label means a new window), so the memo never has to
 * recompute under normal operation — re-mounting the hook in a different
 * window naturally picks up the new label.
 */
import { useMemo } from "react";
import { getCurrentWindowLabel, parseWorkspaceLabel } from "@lib/window-label";

export function useCurrentWindowConnectionId(): string | null {
  // Read the label once per render; `getCurrentWindowLabel` already
  // swallows IPC errors and returns `null` outside of a Tauri runtime
  // (jsdom tests). The memo collapses the parse step to a single call
  // per label change — in practice the label is stable, so this is one
  // call total per hook subscription.
  const label = getCurrentWindowLabel();
  return useMemo(() => {
    if (label === null) return null;
    return parseWorkspaceLabel(label);
  }, [label]);
}
