import { useEffect } from "react";
import { useThemeStore } from "@stores/themeStore";
import { subscribeSystemModeChange, type ThemeMode } from "@lib/themeBoot";

type Theme = ThemeMode;

/**
 * Backwards-compatible shim over `useThemeStore`. New call sites that need
 * access to the selected `themeId` or `resolvedMode` should consume the store
 * directly.
 */
export function useTheme() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const handleSystemChange = useThemeStore((s) => s.handleSystemChange);

  useEffect(() => {
    if (mode !== "system") return;
    return subscribeSystemModeChange(handleSystemChange);
  }, [mode, handleSystemChange]);

  return { theme: mode, setTheme: (t: Theme) => setMode(t) } as const;
}
