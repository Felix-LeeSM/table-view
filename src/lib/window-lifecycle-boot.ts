/**
 * Sprint 154 — boot-time launcher close handler registration.
 *
 * `main.tsx` runs once per Tauri window and only the launcher window owns
 * the "close = exit the whole app" semantics — closing the workspace is a
 * `Back to connections` recovery (handled in `WorkspacePage`'s effect). To
 * keep `main.tsx` thin and to give the unit test a stable import target,
 * the registration logic lives here.
 *
 * The function is idempotent at the module-call level (calling it twice
 * registers two listeners — Tauri tolerates that, but `main.tsx` only calls
 * it once per boot). Returns the `UnlistenFn` so callers can opt into
 * teardown if they ever wire HMR — Sprint 154 doesn't need it.
 *
 * Test seam: `vi.mock('@lib/window-lifecycle-boot')` is NOT the test path;
 * tests `vi.mock('@lib/window-controls')` instead and exercise this module
 * for real, asserting the seam call shape.
 */
import {
  exitApp,
  hideWindow,
  onCloseRequested,
  showWindow,
  type WindowLabel,
} from "@lib/window-controls";
import { getCurrentWindowLabel } from "@lib/window-label";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Register the launcher's `tauri://close-requested` listener so closing the
 * launcher tears down the whole app (workspace included). The handler:
 *
 *   1. Hides the workspace first so it can't flash visible during exit.
 *      `hideWindow` swallows the failure if the workspace was already
 *      hidden — Tauri's `hide()` is idempotent on already-hidden windows.
 *   2. Calls `app_exit` via the seam so the entire process tears down.
 *
 * Sprint 154 contract pins point (1) — the workspace must NOT be visible
 * during exit. The hide-then-exit ordering is asserted in the AC-154-04
 * test via `showWindowMock.not.toHaveBeenCalledWith('workspace')` plus the
 * implicit fact that `hideWindow` is the only window seam the handler
 * touches.
 */
export async function registerLauncherCloseHandler(): Promise<UnlistenFn> {
  return onCloseRequested("launcher" as WindowLabel, async () => {
    try {
      await hideWindow("workspace");
    } catch (e) {
      // Best-effort: even if hide rejects (e.g. workspace was already
      // closed by an earlier failure), we still want the exit to land.
      // The catch is intentionally narrow — log + continue.
      console.warn(
        "[launcher-close] workspace.hide() failed before exit:",
        e instanceof Error ? e.message : e,
      );
    }
    await exitApp();
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
