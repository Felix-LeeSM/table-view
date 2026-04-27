/**
 * Sprint 150 — current `WebviewWindow.label` resolver.
 *
 * Wraps `getCurrentWebviewWindow()` from `@tauri-apps/api/webviewWindow` so
 * the React entrypoint can route the boot mount by which Tauri window is
 * loading the bundle (`launcher` vs `workspace`). Inside vitest there is no
 * Tauri runtime, so the resolver swallows the call-time failure and
 * returns `null`; tests `vi.mock('@lib/window-label')` to drive the routing
 * branches deterministically.
 *
 * Scope (Sprint 150 only):
 *  - boot-time read at mount.
 *  - no event listeners — Sprint 154 wires real lifecycle.
 *  - no caching — `AppRouter` reads once.
 *
 * Returning `null` (instead of throwing) keeps the router branch defensive:
 * if the seam ever fails in production, the user still lands on the
 * launcher with a `console.warn` rather than a white screen.
 */
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

/**
 * The two known window labels declared in `tauri.conf.json` `app.windows[]`.
 * Kept narrow so the router's switch / fallback is exhaustive at the type
 * level. The router still has to accept `string` because the resolver
 * itself doesn't enforce the union — Tauri may surface unknown labels in
 * the future.
 */
export type KnownWindowLabel = "launcher" | "workspace";

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
    return null;
  }
}
