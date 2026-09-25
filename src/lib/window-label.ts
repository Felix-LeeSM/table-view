/**
 * Current `WebviewWindow.label` resolver. The React entrypoint reads
 * this once at mount to route by window (`launcher` vs `workspace`).
 * Returns `null` (rather than throwing) when the Tauri runtime is
 * absent (vitest jsdom) or the call fails for any reason — the router
 * treats `null` as "fall back to launcher" so the seam can't produce a
 * white screen in production. Tests `vi.mock('@lib/window-label')` to
 * drive the routing branches.
 */
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * The two flavors of window the app knows about. `workspace` windows are
 * per-connection (Q13 in the strategy doc): each window's label is
 * suffixed with its `connection_id` — `workspace-{connection_id}` — so
 * multiple connections can each own a window at the same time (TablePlus
 * pattern). The launcher is a single window with the bare `"launcher"`
 * label.
 *
 * Kept narrow so the router's switch / fallback is exhaustive at the type
 * level. The router still has to accept `string` because the resolver
 * itself doesn't enforce the union — Tauri may surface unknown labels in
 * the future, and tests drive both shapes.
 */
export type KnownWindowLabel = "launcher" | `workspace-${string}`;

/**
 * Format the `WebviewWindow.label` for a workspace window tied to
 * `connection_id`. Mirrors the backend (`launcher.rs`,
 * `commands/open_workspace_window.rs`) so frontend / backend agree on the
 * label byte-for-byte. Returns `"workspace-{connection_id}"`.
 */
export function formatWorkspaceLabel(connectionId: string): string {
  return `workspace-${connectionId}`;
}

/**
 * Inverse of {@link formatWorkspaceLabel}.
 * Returns the `connection_id` embedded in a workspace label, or `null`
 * when `label` is not a workspace label.
 *
 * Notably:
 *   - `"launcher"` → `null`.
 *   - The legacy single `"workspace"` label → `null` —
 *     callers that still pass it MUST be migrated to the per-conn form.
 *   - `"workspace-"` (empty conn_id) → `null` so the empty-id degenerate
 *     case can't be confused with a real connection.
 *
 * This is the only place the prefix is parsed; downstream callers (e.g.
 * `useCurrentWindowConnectionId`) consume the parsed `connection_id`
 * directly.
 */
export function parseWorkspaceLabel(label: string): string | null {
  const prefix = "workspace-";
  if (!label.startsWith(prefix)) {
    return null;
  }
  const id = label.slice(prefix.length);
  if (id.length === 0) {
    return null;
  }
  return id;
}

/**
 * Read the current Tauri webview window's label. Returns `null` when the
 * Tauri runtime isn't available (vitest jsdom, or a runtime in which the
 * IPC bridge is missing) or when the underlying call throws for any other
 * reason — the router treats `null` and unknown labels the same way
 * (warn + fall back to launcher).
 */
export function getCurrentWindowLabel(): string | null {
  try {
    const win = getCurrentWebviewWindow();
    const label = win?.label;
    if (typeof label === "string" && label.length > 0) {
      return label;
    }
    return null;
  } catch {
    // Tauri runtime unavailable (vitest jsdom) — caller falls back to launcher.
    return null;
  }
}
