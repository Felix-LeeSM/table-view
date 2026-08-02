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
 * `globalLogVisible` / `operationsVisible` moved here from `MainArea`'s
 * local `useState` so the toolbar buttons can advertise `aria-pressed`
 * without the same drilling. The `toggle-global-query-log` /
 * `toggle-operations-panel` custom-event channel is unchanged — `MainArea`
 * still owns the listeners (so `App.tsx`'s Cmd+Shift+C keeps working), it
 * just writes here instead of to local state.
 *
 * ponytail: session-only, deliberately not persisted. Nothing here calls
 * `persistSettingValue`, so it carries no reset affordance obligation —
 * a reload starts from the expanded default. Persist it (with a reset)
 * only if users ask for the collapse to survive a restart.
 */
export interface LayoutState {
  /** Left panel (schema tree column) hidden. */
  sidebarCollapsed: boolean;
  /** Bottom panel — global query log flyout. */
  globalLogVisible: boolean;
  /** Bottom panel — server operations flyout. */
  operationsVisible: boolean;
  toggleSidebar: () => void;
  toggleGlobalLog: () => void;
  toggleOperations: () => void;
  setGlobalLogVisible: (visible: boolean) => void;
  setOperationsVisible: (visible: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarCollapsed: false,
  globalLogVisible: false,
  operationsVisible: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  toggleGlobalLog: () =>
    set((state) => ({ globalLogVisible: !state.globalLogVisible })),
  toggleOperations: () =>
    set((state) => ({ operationsVisible: !state.operationsVisible })),
  setGlobalLogVisible: (visible) => set({ globalLogVisible: visible }),
  setOperationsVisible: (visible) => set({ operationsVisible: visible }),
}));
