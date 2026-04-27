import { create } from "zustand";
import {
  applyTheme,
  readStoredState,
  resolveMode,
  writeStoredState,
  type ThemeMode,
  type ThemeId,
  type ThemeState,
} from "@lib/themeBoot";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

interface ThemeStoreState {
  themeId: ThemeId;
  mode: ThemeMode;
  resolvedMode: "light" | "dark";

  setTheme: (themeId: ThemeId) => void;
  setMode: (mode: ThemeMode) => void;
  setState: (state: ThemeState) => void;
  hydrate: () => void;
  handleSystemChange: () => void;
}

function computeResolved(mode: ThemeMode): "light" | "dark" {
  return resolveMode(mode);
}

const initial = readStoredState();

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  themeId: initial.themeId,
  mode: initial.mode,
  resolvedMode: computeResolved(initial.mode),

  setTheme: (themeId) => {
    const { mode } = get();
    const resolved = applyTheme(themeId, mode);
    writeStoredState({ themeId, mode });
    set({ themeId, resolvedMode: resolved });
  },

  setMode: (mode) => {
    const { themeId } = get();
    const resolved = applyTheme(themeId, mode);
    writeStoredState({ themeId, mode });
    set({ mode, resolvedMode: resolved });
  },

  setState: ({ themeId, mode }) => {
    const resolved = applyTheme(themeId, mode);
    writeStoredState({ themeId, mode });
    set({ themeId, mode, resolvedMode: resolved });
  },

  hydrate: () => {
    const stored = readStoredState();
    const resolved = applyTheme(stored.themeId, stored.mode);
    set({
      themeId: stored.themeId,
      mode: stored.mode,
      resolvedMode: resolved,
    });
  },

  handleSystemChange: () => {
    const { mode, themeId } = get();
    if (mode !== "system") return;
    const resolved = applyTheme(themeId, mode);
    set({ resolvedMode: resolved });
  },
}));

/**
 * Sprint 153 — cross-window broadcast allowlist for the theme store.
 *
 * Why these keys:
 *  - `themeId` — user-selected catalog theme. Identical between launcher
 *    and workspace by intent (TablePlus parity: theme is a global pref).
 *  - `mode` — `"system" | "light" | "dark"` toggle. Same rationale.
 *
 * Why other keys are EXCLUDED:
 *  - `resolvedMode` — derived field (`resolveMode(mode)` on each window).
 *    Sync-broadcasting it would leak the SENDER's `prefers-color-scheme`
 *    interpretation to the receiver, which may diverge (e.g. one window
 *    on a system-light display, the other on dark). The receiver computes
 *    its own resolved mode from the synced `mode` via the side-effect
 *    subscriber below.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof ThemeStoreState> = [
  "themeId",
  "mode",
] as const;

/**
 * Sprint 153 — when an inbound `theme-sync` payload lands via the bridge,
 * the bridge calls `store.setState({themeId, mode})`. That shallow merge
 * skips our `setTheme` / `setMode` actions, so the DOM `data-theme` /
 * `data-mode` attributes do NOT update by default. This subscriber
 * detects post-merge `themeId`/`mode` drift from `resolvedMode` and
 * re-runs `applyTheme` so both windows render identically. The check is
 * cheap (string compares) and idempotent — re-running `applyTheme` with
 * the already-applied values is a no-op at the DOM level.
 */
let lastApplied = `${initial.themeId}|${initial.mode}`;
useThemeStore.subscribe((state) => {
  const key = `${state.themeId}|${state.mode}`;
  if (key === lastApplied) return;
  lastApplied = key;
  const resolved = applyTheme(state.themeId, state.mode);
  // Only push `resolvedMode` back into the store when it actually changed
  // — avoids subscriber loops when `applyTheme` collapses to the same
  // resolved value.
  if (state.resolvedMode !== resolved) {
    useThemeStore.setState({ resolvedMode: resolved });
  }
  writeStoredState({ themeId: state.themeId, mode: state.mode });
});

/**
 * Sprint 153 — opt the theme store into the Sprint 151 bridge so launcher
 * and workspace stay theme-aligned. Both windows attach unconditionally
 * (theme is a global pref, no window-only sub-mode).
 */
void attachZustandIpcBridge<ThemeStoreState>(useThemeStore, {
  channel: "theme-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: see mruStore.ts for the trade-off rationale.
});
