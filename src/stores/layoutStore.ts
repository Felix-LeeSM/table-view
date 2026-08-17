import { create } from "zustand";

/**
 * Workspace panel visibility — the state behind the workspace toolbar's
 * Layout cluster (issue #1734, owner decision 1: a `role="group"` toggle
 * cluster that collapses the left panel and the bottom panels).
 *
 * Why a store and not props: the left panel (`Sidebar`) is mounted by
 * `WorkspacePage` as a *sibling* of `MainArea`, while the cluster lives
 * inside `MainArea` → `WorkspaceToolbar`. Prop-drilling the flag through
 * both would force `MainArea` and `WorkspaceToolbar` to take props they
 * otherwise don't need.
 *
 * #2426 folded the two separate bottom flyout flags (`globalLogVisible` /
 * `operationsVisible`) plus the grid-local Quick Look flag into ONE dock:
 * `bottomPanelTab` picks which view the dock shows and
 * `bottomPanelCollapsed` hides its body. Two buttons drive the collapse (the
 * toolbar cluster and the dock's own tab strip) and the owner required both
 * to render the same `aria-pressed` — they can only do that by reading this
 * one field, so neither surface gets its own copy.
 *
 * ponytail: session-only, deliberately not persisted. Nothing here calls
 * `persistSettingValue`, so it carries no reset affordance obligation —
 * a reload starts from the expanded-sidebar / collapsed-dock default.
 * Persist it (with a reset) only if users ask for the layout to survive a
 * restart.
 */
export type BottomPanelTab = "history" | "operations" | "details";

export interface LayoutState {
  /** Left panel (schema tree column) hidden. */
  sidebarCollapsed: boolean;
  /** Bottom dock body hidden. The tab strip stays visible either way. */
  bottomPanelCollapsed: boolean;
  /** Which view the bottom dock shows. Survives tab and connection swaps. */
  bottomPanelTab: BottomPanelTab;
  /**
   * Published by the mounted grid: a row is selected and its data is loaded,
   * so the Details tab has something to portal in. `false` whenever no grid
   * is mounted (query / ERD / KV tabs) or nothing is selected — the Details
   * tab then renders its empty state instead of a blank dock.
   */
  detailsAvailable: boolean;
  toggleSidebar: () => void;
  toggleBottomPanel: () => void;
  setBottomPanelCollapsed: (collapsed: boolean) => void;
  /** Pick a tab and expand the dock. What the tab strip's buttons do. */
  selectBottomTab: (tab: BottomPanelTab) => void;
  /**
   * Tab-targeted toggle behind `Cmd/Ctrl+L` (Details) and
   * `Cmd/Ctrl+Shift+C` (History): show `tab`, expanding the dock — or
   * collapse the dock when it is already showing that tab. Distinct from
   * `selectBottomTab` (never collapses, so clicking the selected tab does not
   * yank the panel away) and from `toggleBottomPanel` (never changes the tab).
   */
  showBottomTab: (tab: BottomPanelTab) => void;
  setDetailsAvailable: (available: boolean) => void;
}

/**
 * Every non-action field, in one place. `__resetLayoutStoreForTests` spreads
 * it so a fourth panel flag cannot leave a stale value behind in tests —
 * `setState` merges, so a hand-written literal would silently go incomplete
 * without a type error.
 */
const INITIAL_PANELS = {
  sidebarCollapsed: false,
  // Collapsed by default: the dock replaces two flyouts that both started
  // hidden, so first paint keeps the same vertical space for the grid.
  bottomPanelCollapsed: true,
  bottomPanelTab: "history",
  detailsAvailable: false,
} as const satisfies Omit<
  LayoutState,
  | "toggleSidebar"
  | "toggleBottomPanel"
  | "setBottomPanelCollapsed"
  | "selectBottomTab"
  | "showBottomTab"
  | "setDetailsAvailable"
>;

export const useLayoutStore = create<LayoutState>((set) => ({
  ...INITIAL_PANELS,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleBottomPanel: () =>
    set((state) => ({ bottomPanelCollapsed: !state.bottomPanelCollapsed })),
  setBottomPanelCollapsed: (collapsed) =>
    set({ bottomPanelCollapsed: collapsed }),
  selectBottomTab: (tab) =>
    set({ bottomPanelTab: tab, bottomPanelCollapsed: false }),
  showBottomTab: (tab) =>
    set((state) =>
      state.bottomPanelTab === tab && !state.bottomPanelCollapsed
        ? { bottomPanelCollapsed: true }
        : { bottomPanelTab: tab, bottomPanelCollapsed: false },
    ),
  setDetailsAvailable: (available) => set({ detailsAvailable: available }),
}));

/**
 * Reset hook for tests — same escape hatch as `__resetMruStoreForTests` /
 * `__resetTableActivityStoreForTests`. Called from the global `beforeEach`
 * in `src/test-setup.ts` rather than per-file, so a collapse in one spec
 * cannot leak into the next (`src/test-setup.ts` retired the per-file
 * bandaid for the other process singletons for the same reason).
 */
export function __resetLayoutStoreForTests(): void {
  useLayoutStore.setState({ ...INITIAL_PANELS });
}
