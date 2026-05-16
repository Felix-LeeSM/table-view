/**
 * Boot-time launcher close handler. Sprint 363 (Q13 / strategy line 773)
 * changed the close semantics: the launcher's X button now HIDES the
 * launcher window instead of exiting the app — open workspace windows
 * stay alive, the process stays alive, and the launcher can be
 * resurfaced via the macOS dock icon or system tray.
 *
 * The backend (`src-tauri/src/lib.rs` `on_window_event`) intercepts the
 * `CloseRequested` event with `api.prevent_close()` + a call to
 * `handle_launcher_close_request` (which performs the hide). The JS
 * handler we register here is the **frontend echo**: it issues an extra
 * `hideWindow('launcher')` so jsdom/tauri runtime parity stays in lockstep
 * (the JS-side `onCloseRequested` listener still fires after the backend
 * prevents the close, and a frontend caller may want to react with
 * additional cleanup later).
 *
 * Returns the `UnlistenFn` so callers can opt into teardown later (HMR
 * etc.); not currently used.
 *
 * Tests `vi.mock('@lib/window-controls')` and exercise this module for
 * real, asserting the seam call shape.
 */
import {
  hideWindow,
  onCloseRequested,
  showWindow,
  type WindowLabel,
} from "@lib/window-controls";
import { getCurrentWindowLabel } from "@lib/window-label";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Register the launcher's `tauri://close-requested` listener so closing
 * the launcher hides (NOT exits) — sprint-363 semantics:
 *
 *   1. The backend's `on_window_event` matcher already intercepts the
 *      OS-level close with `api.prevent_close()` and hides the launcher.
 *      That is the authoritative path.
 *   2. The JS handler issues a complementary `hideWindow('launcher')`
 *      so renderer-driven cleanups (focus restoration, ARIA, etc.) can
 *      observe the same lifecycle hook in unit tests under jsdom
 *      where the backend matcher doesn't run.
 *   3. Workspace windows are explicitly NOT touched — the user may
 *      still be working in a `workspace-{conn_id}` window.
 *
 * Pre-sprint-363 the handler called `exitApp()`; that path is retired.
 */
export async function registerLauncherCloseHandler(): Promise<UnlistenFn> {
  return onCloseRequested("launcher" as WindowLabel, async () => {
    // Mirror the backend's hide. `hideWindow` swallows errors as
    // best-effort — the backend has already prevented the close, so a
    // missing JS hide does not produce a user-visible regression.
    await hideWindow("launcher");
  });
}

/**
 * Boot helper: register the close handler ONLY when the current window is
 * the launcher. Workspace's close semantics live inside `WorkspacePage`'s
 * mount effect. `main.tsx` calls this unconditionally; the launcher branch
 * fires the registration, the workspace branch is a no-op.
 */
export async function bootWindowLifecycle(): Promise<void> {
  const label = getCurrentWindowLabel();
  if (label !== "launcher") return;
  // Suppress the unlisten — main.tsx never tears down the listener.
  await registerLauncherCloseHandler();
}

// Re-export `showWindow` so future sprints that grow the boot module don't
// have to thread additional imports — keeps the boot surface pinned to one
// import statement in `main.tsx`.
export { showWindow };
