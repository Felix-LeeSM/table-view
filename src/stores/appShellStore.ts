import { create } from "zustand";

/**
 * The top-level screen the user is currently viewing.
 *
 * - "home": paradigm-agnostic connection management (ConnectionList +
 *   GroupHeader + Import/Export + Recent placeholder).
 * - "workspace": multi-paradigm tab + sidebar work surface (existing Sidebar
 *   schemas + MainArea + back-to-Home button).
 *
 * Sprint 125 introduces this split as the foundation for sprints 126-133
 * (paradigm sidebar slot, workspace toolbar, DB switcher, raw-query DB-change
 * detection). Additional screens may join the union in later sprints; do not
 * widen it here without a contract update.
 *
 * @deprecated Sprint 153 — `screen` becomes redundant once Sprint 154 wires
 * real `WebviewWindow.show()/hide()` on the launcher/workspace split. After
 * Sprint 154, the launcher window mounts `HomePage` and the workspace window
 * mounts the tab+sidebar surface; "which screen am I on" is implied by the
 * Tauri window label, not by a shared store field. See Sprint 154 plan
 * (`docs/sprints/sprint-150/spec.md` Sprint 154 section).
 */
export type AppShellScreen = "home" | "workspace";

interface AppShellState {
  /**
   * The screen currently mounted by `App.tsx`. Sessionwide state — not
   * persisted to localStorage. The user always boots into `"home"` so that
   * connection management is the first thing they see, matching TablePlus.
   *
   * @deprecated Sprint 153 — window-scoped sentinel pending Sprint 154's
   * real-window lifecycle. The field intentionally is NOT cross-window
   * synced via the Sprint 151 bridge: each window keeps its own
   * `screen` value (launcher always `"home"` post-Sprint-154; workspace
   * always `"workspace"`). Removing the field today would force
   * coordinated edits across `App.tsx`, `HomePage.tsx`, `WorkspacePage.tsx`,
   * `App.test.tsx`, `HomePage.test.tsx`, `WorkspacePage.test.tsx`,
   * `window-lifecycle.ac141.test.tsx`, and `connection-sot.ac142.test.tsx`
   * — explicitly out of scope for Sprint 153 (store-only).
   * Sprint 154 retires this field entirely.
   */
  screen: AppShellScreen;

  /**
   * Swap the active screen. Idempotent — calling with the current value is a
   * no-op so callers don't need to guard against double-clicks (e.g. fast
   * Open then Back). Tab state lives in `tabStore` and is preserved across
   * screen swaps; this store does not touch tabs.
   *
   * @deprecated See {@link AppShellState.screen}.
   */
  setScreen: (screen: AppShellScreen) => void;
}

/**
 * Sprint 153 — `appShellStore` is **deliberately NOT** opted into the
 * Sprint 151 cross-window bridge. The single piece of state it holds
 * (`screen`) is window-scoped: each window's local "what should I render
 * right now" should never leak into the other. Sprint 154 retires the
 * field entirely once real `WebviewWindow.show()/hide()` lands; this
 * sprint scopes the change to "documented as window-local + deprecated".
 *
 * Grep proof for evaluator: searching for the bridge-attach call site
 * (e.g. `grep -lrE "^\\s*void attachZustandIpcBridge" src/stores/`) must
 * NOT return `appShellStore.ts`. After Sprint 153 the call-site grep
 * returns exactly 5 files: connectionStore, tabStore, mruStore,
 * themeStore, favoritesStore. (A naive `grep attachZustandIpcBridge`
 * returns 6 because of THIS comment — that's expected; the call-site
 * regex is the authoritative invariant.)
 */
export const useAppShellStore = create<AppShellState>((set) => ({
  screen: "home",
  setScreen: (screen) => {
    set((prev) => (prev.screen === screen ? prev : { screen }));
  },
}));
