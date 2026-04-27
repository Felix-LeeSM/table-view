import { create } from "zustand";

/**
 * Sprint 154 — `appShellStore` is now a vestigial test-only seam.
 *
 * Phase 12's multi-window split (Sprint 150 boot routing + Sprint 154 real
 * lifecycle wiring) replaced "which screen am I on" with "which Tauri
 * `WebviewWindow.label` is mounting this React tree". The launcher window
 * always mounts `HomePage` (via `LauncherPage`); the workspace window
 * always mounts `WorkspacePage`. There is no longer a single window that
 * needs to swap between them, so production code does NOT use `screen`
 * or `setScreen` for any routing or behaviour decision.
 *
 * The field + action are retained ONLY so that pre-Sprint-154 protected
 * test fixtures (notably `cross-window-store-sync.test.tsx` AC-153-05,
 * which is byte-frozen) keep compiling and running. New code MUST NOT
 * read or write `screen`. Sprint 155 (or later) may delete the field
 * outright once the protected scope releases.
 *
 * @deprecated Sprint 154 — production routing comes from
 *   `getCurrentWindowLabel()` and the `@lib/window-controls` seam. Do not
 *   add new callers.
 */
export type AppShellScreen = "home" | "workspace";

interface AppShellState {
  /**
   * Vestigial post-Sprint-154 — left in place ONLY for byte-frozen test
   * fixtures. Production code reads window context from
   * `getCurrentWindowLabel()` instead.
   *
   * @deprecated See {@link useAppShellStore} module doc.
   */
  screen: AppShellScreen;

  /**
   * Vestigial post-Sprint-154 — never invoked from production code.
   *
   * @deprecated See {@link useAppShellStore} module doc.
   */
  setScreen: (screen: AppShellScreen) => void;
}

/**
 * Sprint 153 left this store off the cross-window bridge (it is window-
 * scoped state and was never meant to broadcast). Sprint 154 confirms
 * that decision: there is no `attachZustandIpcBridge(useAppShellStore)`
 * call site anywhere in `src/stores/` — the bridge attaches to exactly
 * five stores (connection, tab, mru, theme, favorites).
 */
export const useAppShellStore = create<AppShellState>((set) => ({
  screen: "home",
  setScreen: (screen) => {
    set((prev) => (prev.screen === screen ? prev : { screen }));
  },
}));
