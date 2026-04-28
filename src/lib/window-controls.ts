/**
 * Sprint 154 — thin testable seam over Tauri's `WebviewWindow` API.
 *
 * Phase 12 finally wires the user-facing transitions (Activate / Back /
 * Disconnect / Window close) to real `WebviewWindow.show/hide/setFocus()`
 * calls + the `app_exit` Tauri command. The Pages MUST go through this seam
 * rather than calling `WebviewWindow.getByLabel(...)` directly so that:
 *
 *   1. unit tests can `vi.mock('@lib/window-controls')` and assert call
 *      ordering for the 5 transitions without touching real Tauri internals;
 *   2. error handling is centralized — a failed `show()` from any caller
 *      surfaces a single, consistent toast instead of N ad-hoc try/catches;
 *   3. the launcher / workspace label union is enforced at the type level so
 *      a typo can't compile.
 *
 * Sprint 154 keeps the surface intentionally small — show, hide, focus,
 * close, exit, plus a `tauri://close-requested` listener helper. Anything
 * else (`setSize`, `setPosition`, `minimize`, etc.) is out of scope and
 * lives in later sprints if it ever lands.
 *
 * Inside vitest there is no Tauri runtime, so each helper swallows the
 * call-time failure with a single `console.warn`. Tests `vi.mock(...)` the
 * whole module and never exercise this defensive branch.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * The two known window labels declared in `tauri.conf.json` `app.windows[]`.
 * Mirrors the union in `src/lib/window-label.ts` but kept independent so the
 * boot-time resolver and the runtime controls stay decoupled at the import
 * level (one is a passive read; the other is an action surface).
 */
export type WindowLabel = "launcher" | "workspace";

/**
 * Resolve the `WebviewWindow` for `label`. Tauri's `WebviewWindow.getByLabel`
 * is an async-by-runtime API — it returns the handle synchronously when the
 * window already exists, but throws if Tauri isn't initialized. We keep the
 * resolver `async` so callers can `await` uniformly.
 *
 * Returns `null` when the Tauri runtime is unavailable (vitest jsdom) or the
 * label is unknown to the runtime; callers map that to a no-op + warn.
 */
async function resolveWindow(
  label: WindowLabel,
): Promise<import("@tauri-apps/api/webviewWindow").WebviewWindow | null> {
  try {
    // `getByLabel` was renamed across Tauri 1→2; in Tauri 2 it lives on the
    // namespace import. We grab it dynamically so a missing runtime collapses
    // to the catch path instead of a static import error.
    const mod = await import("@tauri-apps/api/webviewWindow");
    // Tauri 2's `getByLabel` is async — it round-trips through `invoke`
    // under the hood. Awaiting here lets us catch the jsdom-no-runtime
    // rejection in the surrounding try/catch instead of letting it bubble
    // up as an unhandled rejection.
    const win = await mod.WebviewWindow.getByLabel(label);
    return win ?? null;
  } catch (e) {
    console.warn(
      `[window-controls] resolveWindow(${label}) failed:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Show `label`'s window. Idempotent — calling on an already-visible window
 * is a no-op from the user's perspective.
 *
 * When `resolveWindow` returns null for the workspace label, the command
 * invokes the Rust-side `workspace_ensure` command which recreates the
 * window from `tauri.conf.json` config using `WebviewWindowBuilder::from_config`,
 * then retries the resolve + show. This handles the case where the workspace
 * window was destroyed before the `onCloseRequested` listener was registered.
 */
export async function showWindow(label: WindowLabel): Promise<void> {
  let win = await resolveWindow(label);
  if (!win && label === "workspace") {
    await invoke("workspace_ensure");
    win = await resolveWindow(label);
  }
  if (!win) {
    throw new Error(
      `[window-controls] showWindow(${label}): window not found — is it declared in tauri.conf.json?`,
    );
  }
  await win.show();
}

/**
 * Hide `label`'s window without closing it — re-showing must be instant.
 * Used by the Back flow (workspace → launcher) and by the activation flow
 * (launcher hides after workspace becomes visible).
 */
export async function hideWindow(label: WindowLabel): Promise<void> {
  const win = await resolveWindow(label);
  if (!win) return;
  await win.hide();
}

/**
 * Bring `label`'s window to the front and give it input focus. Called
 * immediately after `showWindow(label)` on the activation path so the
 * workspace receives keystrokes the moment it becomes visible.
 */
export async function focusWindow(label: WindowLabel): Promise<void> {
  const win = await resolveWindow(label);
  if (!win) return;
  await win.setFocus();
}

/**
 * Close `label`'s window outright. Sprint 154 doesn't currently use this —
 * the close paths route through `exitApp()` (launcher) and `hideWindow`
 * (workspace) — but it's exposed for completeness so future sprints don't
 * have to widen the seam in a hot patch.
 */
export async function closeWindow(label: WindowLabel): Promise<void> {
  const win = await resolveWindow(label);
  if (!win) return;
  await win.close();
}

/**
 * Exit the entire process. Routed through the `app_exit` Tauri command
 * (defined in `src-tauri/src/launcher.rs`) instead of `window.close()` so
 * closing the launcher window tears down the whole app — `window.close()`
 * would only close the launcher, leaving the workspace process orphaned.
 */
export async function exitApp(): Promise<void> {
  await invoke("app_exit");
}

/**
 * Register a `tauri://close-requested` listener on `label`'s window with
 * `preventDefault()` semantics so the OS-level close becomes the recovery
 * action (Back for workspace, app exit for launcher) rather than a true
 * window close.
 *
 * Returns the `UnlistenFn` from Tauri so the caller's React effect can
 * detach the listener on unmount.
 *
 * In the jsdom test environment we cannot register real Tauri events, so
 * the helper falls back to a no-op + console.warn and returns a no-op
 * `UnlistenFn`. Tests that need to drive the close-requested branch
 * `vi.mock(...)` this module and supply their own listener stub.
 */
export async function onCloseRequested(
  label: WindowLabel,
  handler: () => void | Promise<void>,
): Promise<UnlistenFn> {
  const win = await resolveWindow(label);
  if (!win) {
    return () => {};
  }
  return win.onCloseRequested((event) => {
    // The contract requires the OS-level close to NOT actually close the
    // window — instead the handler chooses the user-facing recovery. So we
    // always preventDefault and then fire the handler.
    event.preventDefault();
    void handler();
  });
}

/**
 * Re-export for callers that need to scope listeners to "the current
 * window" without hardcoding a label. Sprint 154 currently scopes by
 * explicit label (launcher.tsx vs workspace.tsx), so this is a thin
 * convenience.
 */
export async function onCurrentWindowCloseRequested(
  handler: () => void | Promise<void>,
): Promise<UnlistenFn> {
  try {
    const win = getCurrentWebviewWindow();
    return win.onCloseRequested((event) => {
      event.preventDefault();
      void handler();
    });
  } catch (e) {
    console.warn(
      "[window-controls] onCurrentWindowCloseRequested failed:",
      e instanceof Error ? e.message : e,
    );
    return () => {};
  }
}
