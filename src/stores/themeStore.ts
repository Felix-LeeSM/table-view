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
 * Cross-window broadcast allowlist. Only the user pick (`themeId` +
 * `mode`) is shared. `resolvedMode` is excluded on purpose — each
 * window resolves its own `prefers-color-scheme`, which can diverge
 * (one display on light, the other on dark).
 */
export const SYNCED_KEYS: ReadonlyArray<keyof ThemeStoreState> = [
  "themeId",
  "mode",
] as const;

/**
 * Inbound `theme-sync` payloads land via `store.setState({themeId,
 * mode})` — a shallow merge that skips `setTheme` / `setMode`. This
 * subscriber re-runs `applyTheme` on `themeId`/`mode` drift so the DOM
 * `data-*` attributes track the synced state. The string compare is
 * cheap and `applyTheme` is idempotent at the DOM level.
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

// Theme is a global pref — both windows attach unconditionally.
void attachZustandIpcBridge<ThemeStoreState>(useThemeStore, {
  channel: "theme-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: see mruStore.ts for the trade-off rationale.
});
