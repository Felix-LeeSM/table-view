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
    // Tauri runtime unavailable (vitest jsdom) — caller falls back to launcher.
    return null;
  }
}
