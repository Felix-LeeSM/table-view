import { useEffect, type DependencyList } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";

/**
 * Register a Tauri event listener with a cancel-safe teardown (#1370).
 *
 * `listen()` and subscribe factories are async: a fast unmount (Back
 * navigation, window close) can run cleanup before the promise resolves,
 * leaking a live listener onto a torn-down webview — the `no such window`
 * crash of #1261. This guards that race in one place instead of the
 * hand-rolled `cancelled` flag each call site repeated.
 *
 * Pass `null` for `subscribe` to skip registration (e.g. no connection id yet).
 * Setup rejections — a Tauri runtime absent under jsdom — are swallowed: there
 * is nothing to recover and an unhandled rejection would surface as noise.
 *
 * `deps` is forwarded verbatim to the inner effect; the caller owns it (event
 * name plus any values the handler captures), same as an inline `useEffect`.
 */
export function useTauriListener(
  subscribe: (() => Promise<UnlistenFn>) | null,
  deps: DependencyList,
): void {
  useEffect(() => {
    if (!subscribe) return;
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;
    void subscribe()
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller-owned deps
  }, deps);
}
