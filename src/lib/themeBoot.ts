import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_THEME_ID, isThemeId, type ThemeId } from "./themeCatalog";

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeState {
  themeId: ThemeId;
  mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "table-view-theme";

export { DEFAULT_THEME_ID } from "./themeCatalog";
export type { ThemeId } from "./themeCatalog";

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
 * Wave 9.5 회귀 7 (2026-05-17) — backend 가 theme 의 authoritative SOT 다.
 * Tauri 2 의 각 webview 는 별도의 `localStorage` 를 갖기 때문에 launcher 의
 * LS write 가 새로 열리는 workspace 의 LS 에 보이지 않는다. 그래서 새 창의
 * 첫 paint 는 자기 LS 값 (대부분 비어있어서 `DEFAULT_THEME_ID = "slate"`) 으로
 * 떨어지고, snapshot async hydrate 가 뒤늦게 도착해도 사용자가 짧은 slate flash
 * 를 본다.
 *
 * 본 함수는 backend `get_setting("theme")` 으로 SQLite truth 를 읽고
 * 1차 LS-fast-paint 와 다르면 DOM + LS 를 갱신한다. main.tsx 의 boot 가
 * `bootTheme()` (LS fast paint) 직후 await 하여 새 webview 의 첫 render
 * 전에 SQLite 값을 적용. Tauri 가 없는 환경 (vitest jsdom) 에서는 IPC 가
 * throw → null 로 graceful fallback.
 */
export async function reconcileThemeFromBackend(): Promise<void> {
  let raw: string | null;
  try {
    raw = await invoke<string | null>("get_setting", { key: "theme" });
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
