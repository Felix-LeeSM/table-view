import { invoke } from "@tauri-apps/api/core";
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

  // Sprint 368 (Phase 4 Q12) — actions are backend-first. `setTheme` /
  // `setMode` / `setState` issue `persist_setting("theme", JSON)` IPC and
  // only mutate the store + sync LS after the IPC resolves. Reject path
  // re-throws so callers can surface a toast; the store stays at the last
  // successfully-persisted value so the next boot's FOUC cache (LS) stays
  // consistent with SQLite truth.
  setTheme: (themeId: ThemeId) => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setState: (state: ThemeState) => Promise<void>;
  hydrate: () => void;
  handleSystemChange: () => void;
}

function computeResolved(mode: ThemeMode): "light" | "dark" {
  return resolveMode(mode);
}

const initial = readStoredState();

/**
 * Sprint 368 (Phase 4 Q12) — backend-first theme persistence helper.
 *
 * Wraps `persist_setting("theme", JSON)` so the three actions
 * (`setTheme` / `setMode` / `setState`) all funnel through the same IPC
 * call site. The `valueJson` field is the strategy F.4 wire shape
 * (`{themeId, mode}`); store mutate + LS sync are deferred to the
 * action's `await` continuation so a rejected IPC leaves the store at
 * its previous value (strategy line 1282 — "LS 는 마지막 성공값 유지").
 */
async function persistThemeSetting(value: ThemeState): Promise<void> {
  await invoke("persist_setting", {
    req: {
      key: "theme",
      valueJson: JSON.stringify(value),
    },
  });
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  themeId: initial.themeId,
  mode: initial.mode,
  resolvedMode: computeResolved(initial.mode),

  setTheme: async (themeId) => {
    const { mode } = get();
    await persistThemeSetting({ themeId, mode });
    // `resolvedMode` is recomputed here (rather than relying on the
    // subscriber) because `system` mode resolution depends on the
    // process's current `prefers-color-scheme` reading — setting the
    // same `mode` literal can still flip `resolvedMode` if the OS
    // theme toggled between calls (e.g. day/night switch). The
    // subscriber short-circuits on `themeId|mode` equality, so a
    // resolvedMode-only delta would be missed.
    const resolved = resolveMode(mode);
    set({ themeId, resolvedMode: resolved });
  },

  setMode: async (mode) => {
    const { themeId } = get();
    await persistThemeSetting({ themeId, mode });
    const resolved = resolveMode(mode);
    set({ mode, resolvedMode: resolved });
  },

  setState: async ({ themeId, mode }) => {
    await persistThemeSetting({ themeId, mode });
    const resolved = resolveMode(mode);
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
 * Inbound `theme-sync` payloads (and inbound `state-changed` setting
 * refetches) land via `store.setState({themeId, mode})` — a shallow
 * merge that skips the action funnel. This subscriber re-runs
 * `applyTheme` on `themeId` / `mode` drift so the DOM `data-*`
 * attributes track the synced state AND writes the FOUC cache to LS so
 * the next boot's first paint matches SQLite truth.
 *
 * Sprint 368 (Phase 4 Q12) — the action funnel itself does NOT call
 * `writeStoredState`; it relies on this subscriber to perform the single
 * LS write per state change. This keeps the action path and the
 * cross-window receiver path symmetric (both end in `set({...})`) and
 * guarantees exactly one LS write per `themeId`/`mode` transition.
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

/**
 * Sprint 368 (Phase 4 Q12) — `state-changed` setting domain receiver.
 *
 * Backend `persist_setting("theme", …)` emits `{domain:"setting",
 * op:"update", entityId:"theme"}`. The sprint-365 dispatcher routes the
 * non-self-echo branch here. Refetch the canonical SQLite value via
 * `get_setting("theme")` and apply it through the underlying setter so
 * the LS-sync subscriber writes the FOUC cache.
 *
 * The refetch (rather than trusting the event payload) is the strategy
 * F.4 line 1388 contract — "event 는 알림, 실제 값은 수신자가 refetch".
 * It also keeps the receiver shape uniform across all `setting` keys
 * (theme / safe_mode / sidebar_width / …): the dispatcher dispatches one
 * `onUpdated`, the handler dispatches per-key.
 */
/**
 * Per-entity `setting.update` refetch for the `theme` key. Exported so
 * the unified setting receiver (`src/lib/events/settingsReceiver.ts`)
 * can delegate without having to know the parse / store internals.
 */
export async function applyThemeSettingFromBackend(): Promise<void> {
  const raw = await invoke<string | null>("get_setting", { key: "theme" });
  if (raw === null) return;
  const parsed = parseThemeSettingValue(raw);
  if (parsed === null) return;
  useThemeStore.setState({
    themeId: parsed.themeId,
    mode: parsed.mode,
  });
}

function parseThemeSettingValue(raw: string): ThemeState | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return null;
    const r = parsed as Record<string, unknown>;
    const themeId = r.themeId;
    const mode = r.mode;
    if (typeof themeId !== "string") return null;
    if (mode !== "system" && mode !== "light" && mode !== "dark") return null;
    return { themeId: themeId as ThemeId, mode };
  } catch {
    return null;
  }
}
