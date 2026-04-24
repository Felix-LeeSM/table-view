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
