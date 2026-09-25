import { getSetting } from "./tauri/settings";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themeCatalog";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeState {
  themeId: ThemeId;
  mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "table-view-theme";

export type { ThemeId } from "./themeCatalog";
export { DEFAULT_THEME_ID } from "./themeCatalog";

const DEFAULT_STATE: ThemeState = {
  themeId: DEFAULT_THEME_ID,
  mode: "system",
};

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function getSystemDarkMatch(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") return getSystemDarkMatch() ? "dark" : "light";
  return mode;
}

export function readStoredState(): ThemeState {
  if (typeof window === "undefined") return { ...DEFAULT_STATE };
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw === null) return { ...DEFAULT_STATE };

  if (isThemeMode(raw)) {
    return { themeId: DEFAULT_THEME_ID, mode: raw };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_STATE };
    }
    const candidate = parsed as Record<string, unknown>;
    const themeId = isThemeId(candidate.themeId)
      ? candidate.themeId
      : DEFAULT_THEME_ID;
    const mode = isThemeMode(candidate.mode) ? candidate.mode : "system";
    return { themeId, mode };
  } catch {
    // localStorage unavailable or stored value malformed — fall back to defaults.
    return { ...DEFAULT_STATE };
  }
}

export function readStoredMode(): ThemeMode {
  return readStoredState().mode;
}

export function writeStoredState(state: ThemeState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state));
}

export function applyTheme(
  themeId: ThemeId,
  mode: ThemeMode,
): "light" | "dark" {
  const resolved = resolveMode(mode);
  const root = document.documentElement;
  root.setAttribute("data-theme", themeId);
  root.setAttribute("data-mode", resolved);
  return resolved;
}

export function applyMode(mode: ThemeMode): "light" | "dark" {
  return applyTheme(DEFAULT_THEME_ID, mode);
}

export function bootTheme(): void {
  const state = readStoredState();
  applyTheme(state.themeId, state.mode);
}

/**
 * The backend is the authoritative source of truth for the theme
 * (2026-05-17). Each Tauri 2 webview has its own `localStorage`, so the
 * launcher's LS write is not visible in a newly opened workspace's LS. A new
 * window's first paint therefore falls back to its own LS value (usually
 * empty, so `DEFAULT_THEME_ID = "slate"`), and although the async snapshot
 * hydrate arrives later, the user sees a short slate flash.
 *
 * This function reads the SQLite truth through backend `get_setting("theme")`
 * and updates the DOM + LS when it differs from the first LS fast paint. The
 * boot in main.tsx awaits it after `bootTheme()` (LS fast paint), so the
 * SQLite value applies before the new webview's first render. Without Tauri
 * (vitest jsdom) the IPC throws and the function returns early, a graceful
 * fallback that leaves the fast-paint values in place.
 */
export async function reconcileThemeFromBackend(): Promise<void> {
  let raw: string | null;
  try {
    raw = await getSetting("theme");
  } catch {
    return;
  }
  if (raw === null) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const candidate = parsed as Record<string, unknown>;
  if (!isThemeId(candidate.themeId)) return;
  if (!isThemeMode(candidate.mode)) return;
  const backendState: ThemeState = {
    themeId: candidate.themeId,
    mode: candidate.mode,
  };
  const lsState = readStoredState();
  if (
    backendState.themeId === lsState.themeId &&
    backendState.mode === lsState.mode
  ) {
    return;
  }
  applyTheme(backendState.themeId, backendState.mode);
  writeStoredState(backendState);
}

/**
 * Subscribe to OS-level prefers-color-scheme changes so that `mode === "system"`
 * continues to reflect the correct light/dark resolution at runtime.
 * Returns an unsubscribe function. No-op outside the browser.
 */
export function subscribeSystemModeChange(handler: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
