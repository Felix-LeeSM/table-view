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
 */
export type AppShellScreen = "home" | "workspace";

interface AppShellState {
  /**
   * The screen currently mounted by `App.tsx`. Sessionwide state — not
   * persisted to localStorage. The user always boots into `"home"` so that
   * connection management is the first thing they see, matching TablePlus.
   */
  screen: AppShellScreen;

  /**
   * Swap the active screen. Idempotent — calling with the current value is a
   * no-op so callers don't need to guard against double-clicks (e.g. fast
   * Open then Back). Tab state lives in `tabStore` and is preserved across
   * screen swaps; this store does not touch tabs.
   */
  setScreen: (screen: AppShellScreen) => void;
}

export const useAppShellStore = create<AppShellState>((set) => ({
  screen: "home",
  setScreen: (screen) => {
    set((prev) => (prev.screen === screen ? prev : { screen }));
  },
}));
