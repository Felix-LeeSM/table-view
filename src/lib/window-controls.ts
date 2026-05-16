/**
 * Thin testable seam over Tauri's window lifecycle. Show / hide / focus
 * / exit route through Rust commands rather than JS `getByLabel` +
 * `win.show()` — `getByLabel` returns `null` for windows the Rust side
 * knows about, which made the workspace fail to appear. Rust's
 * `app.get_webview_window()` is the canonical registry.
 *
 * Workspace-show falls back to `workspace_ensure` when the window was
 * destroyed; that path rebuilds via `WebviewWindowBuilder::from_config`
 * before retrying.
 *
 * `onCloseRequested` / `closeWindow` / `onCurrentWindowCloseRequested`
 * still use `resolveWindow` (`getByLabel`) — they're called from within
 * the window itself, where the API is reliable.
 */
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { logger } from "./logger";

/**
 * The two known window labels declared in `tauri.conf.json` `app.windows[]`.
 */
export type WindowLabel = "launcher" | "workspace";

/**
 * Resolve the `WebviewWindow` for `label`. Used only by operations that need
 * a window handle (event registration, close). Returns `null` when the Tauri
 * runtime is unavailable (vitest jsdom) or the label is unknown.
 */
async function resolveWindow(
  label: WindowLabel,
): Promise<import("@tauri-apps/api/webviewWindow").WebviewWindow | null> {
  try {
    const mod = await import("@tauri-apps/api/webviewWindow");
    const win = await mod.WebviewWindow.getByLabel(label);
    return win ?? null;
  } catch (e) {
    logger.warn(
      `[window-controls] resolveWindow(${label}) failed:`,
      e instanceof Error ? e.message : e,
    );
    return null;
  }
}

/**
 * Show `label`'s window via the Rust-side command. The Rust command uses
 * `app.get_webview_window()` which is the canonical window registry — this
 * bypasses the unreliable JS `getByLabel` API.
 *
 * For the workspace label, if `workspace_show` fails the command retries
 * after invoking `workspace_ensure` to recreate the window from config.
 */
export async function showWindow(label: WindowLabel): Promise<void> {
  try {
    await invoke(`${label}_show`);
  } catch (e) {
    if (label === "workspace") {
      await invoke("workspace_ensure");
      await invoke("workspace_show");
    } else {
      throw e;
    }
  }
}

/**
 * Hide `label`'s window without closing it — re-showing must be instant.
 * Best-effort: swallows errors since the window might already be gone.
 */
export async function hideWindow(label: WindowLabel): Promise<void> {
  try {
    await invoke(`${label}_hide`);
  } catch {
    // Best-effort — window might already be gone.
  }
}

/**
 * Bring `label`'s window to the front and give it input focus. Called
 * immediately after `showWindow(label)` on the activation path so the
 * workspace receives keystrokes the moment it becomes visible.
 * Best-effort: swallows errors since a focus failure isn't user-visible.
 */
export async function focusWindow(label: WindowLabel): Promise<void> {
  try {
    await invoke(`${label}_focus`);
  } catch {
    // Best-effort — focus failure isn't user-visible.
  }
}

/**
 * Close `label`'s window outright. Currently unused at runtime — close
 * paths go through `exitApp()` (launcher) and `hideWindow` (workspace)
 * — but exposed so the seam doesn't need a hot patch later.
 */
export async function closeWindow(label: WindowLabel): Promise<void> {
  const win = await resolveWindow(label);
  if (!win) return;
  await win.close();
}

/**
 * Wave 9.5 (2026-05-16) — destroy the current window via backend IPC.
 *
 * **Why `invoke("workspace_close")` and not `getCurrentWebviewWindow().destroy()`?**
 * 회귀 보고 후 진단 결과: JS-side `WebviewWindow.destroy()` 가 일부 환경에서
 * silent no-op 으로 떨어진다 (Tauri 2.10.1 macOS 관찰). frontend test 는
 * `vi.mock` 으로 binding layer 를 stub 하기 때문에 이 silent failure 를
 * 잡지 못한다 — jsdom 에는 Tauri webview API 가 없고, mock 은 항상 resolve
 * 한다.
 *
 * Backend `workspace_close` (launcher.rs) 는 `tauri::WebviewWindow` 매개변수로
 * 호출 webview 의 핸들을 자동 inject 받아 `Window::destroy()` 를 직접 호출한다.
 * JS↔Rust binding 의 모든 quirk 가 우회되고, `tracing::info!` 로 호출 흔적이
 * 남아 silent failure 도 디버그 가능하다. backend 의 `Window::destroy()` 는
 * close-requested 라이프사이클을 우회 + `WindowEvent::Destroyed` 만 발사 →
 * `handle_workspace_destroyed_safety_net` 의 launcher show + focus 로직도 정상
 * dispatch.
 */
export async function destroyCurrentWindow(): Promise<void> {
  try {
    await invoke("workspace_close");
  } catch (e) {
    logger.warn(
      "[window-controls] destroyCurrentWindow failed:",
      e instanceof Error ? e.message : e,
    );
  }
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
 * window" without hardcoding a label. Most callers scope by explicit
 * label (launcher.tsx vs workspace.tsx), so this is a thin convenience.
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
    logger.warn(
      "[window-controls] onCurrentWindowCloseRequested failed:",
      e instanceof Error ? e.message : e,
    );
    return () => {};
  }
}
