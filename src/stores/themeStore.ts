import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { getSetting, persistSettingValue } from "@lib/tauri/settings";
import {
  applyTheme,
  readStoredState,
  resolveMode,
  type ThemeId,
  type ThemeMode,
  type ThemeState,
  writeStoredState,
} from "@lib/themeBoot";
import { getCurrentWindowLabel } from "@lib/window-label";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { create } from "zustand";

interface ThemeStoreState {
  themeId: ThemeId;
  mode: ThemeMode;
  resolvedMode: "light" | "dark";

  // 2026-05-17 — optimistic UI. The earlier backend-first contract (store
  // mutate after the IPC response) left the user silently stuck after a
  // click on a backend reject / dev rebuild miss — it looked like "picking
  // a theme does nothing". A user preference like theme does not need strong
  // consistency; the immediate visual change the user sees (DOM data-theme)
  // comes first. The actions (1) mutate the store first (the subscriber
  // fires at once → DOM / LS FOUC cache / cross-window broadcast), then (2)
  // send the `persist_setting` IPC fire-and-forget.
  //
  // #1092 — an earlier comment said the next boot's reconcile path recovers
  // an IPC reject, but that reconcile was never wired. When the SQLite write
  // fails, the boot snapshot can overwrite the LS FOUC cache with the stale
  // SQLite value and lose the user's pick, so an IPC reject surfaces as
  // logger.warn + an error toast (the store does not re-throw — the UI is
  // already applied).
  setTheme: (themeId: ThemeId) => Promise<void>;
  setMode: (mode: ThemeMode) => Promise<void>;
  setState: (state: ThemeState) => Promise<void>;
  hydrate: () => void;
  hydrateThemeFromSnapshot: (state: ThemeState) => void;
  handleSystemChange: () => void;
}

function computeResolved(mode: ThemeMode): "light" | "dark" {
  return resolveMode(mode);
}

const initial = readStoredState();

/**
 * state-management-strategy Q12 — theme persistence helper.
 *
 * Wraps `persist_setting("theme", JSON)` so the three actions
 * (`setTheme` / `setMode` / `setState`) all funnel through the same IPC
 * call site. The `valueJson` field is the strategy F.4 wire shape
 * (`{themeId, mode}`). The actions mutate the store before awaiting this
 * helper (see the note on `setTheme` in `ThemeStoreState`), so a rejected
 * IPC leaves the new value in the store and LS — unlike strategy doc line
 * 1285, which keeps the store unchanged and LS at the last successful value.
 */
async function persistThemeSetting(value: ThemeState): Promise<void> {
  await persistSettingValue("theme", value);
}

export const useThemeStore = create<ThemeStoreState>((set, get) => ({
  themeId: initial.themeId,
  mode: initial.mode,
  resolvedMode: computeResolved(initial.mode),

  setTheme: async (themeId) => {
    const { mode } = get();
    // `resolvedMode` is recomputed here (rather than relying on the
    // subscriber) because `system` mode resolution depends on the
    // process's current `prefers-color-scheme` reading — setting the
    // same `mode` literal can still flip `resolvedMode` if the OS
    // theme toggled between calls. The subscriber short-circuits on
    // `themeId|mode` equality, so a resolvedMode-only delta would be missed.
    const resolved = resolveMode(mode);
    set({ themeId, resolvedMode: resolved });
    try {
      await persistThemeSetting({ themeId, mode });
    } catch (e) {
      logger.warn(
        "[themeStore] setTheme persist_setting failed (UI already applied):",
        e instanceof Error ? e.message : e,
      );
      toast.error(i18n.t("feedback:storageWriteFailed"));
    }
  },

  setMode: async (mode) => {
    const { themeId } = get();
    const resolved = resolveMode(mode);
    set({ mode, resolvedMode: resolved });
    try {
      await persistThemeSetting({ themeId, mode });
    } catch (e) {
      logger.warn(
        "[themeStore] setMode persist_setting failed (UI already applied):",
        e instanceof Error ? e.message : e,
      );
      toast.error(i18n.t("feedback:storageWriteFailed"));
    }
  },

  setState: async ({ themeId, mode }) => {
    const resolved = resolveMode(mode);
    set({ themeId, mode, resolvedMode: resolved });
    try {
      await persistThemeSetting({ themeId, mode });
    } catch (e) {
      logger.warn(
        "[themeStore] setState persist_setting failed (UI already applied):",
        e instanceof Error ? e.message : e,
      );
      toast.error(i18n.t("feedback:storageWriteFailed"));
    }
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

  hydrateThemeFromSnapshot: ({ themeId, mode }) => {
    set({ themeId, mode });
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
 * state-management-strategy Q12 — the action funnel itself does NOT call
 * `writeStoredState`; it relies on this subscriber to perform the single
 * LS write per state change. This keeps the action path and the
 * cross-window receiver path symmetric (both end in `set({...})`) and
 * guarantees exactly one LS write per `themeId`/`mode` transition.
 */
let lastApplied = `${initial.themeId}|${initial.mode}`;

/**
 * 2026-05-17 — test-only escape hatch for
 * the module-scope `lastApplied` dedup key. The subscriber short-circuits
 * on `themeId|mode` equality to avoid double LS writes; vitest, however,
 * runs multiple theme-change cases inside one process and would otherwise
 * see the first test's last key suppress the second test's first
 * subscriber pass (no LS write → assertion fails). This helper resets
 * the key to the initial-state shape so the next test starts from a
 * clean ledger. Mirrors the `__resetCountersForTests` /
 * `__resetSessionIdForTests` pattern. Namespaced `__` to flag intent.
 */
export function __resetLastAppliedForTests(): void {
  lastApplied = `${initial.themeId}|${initial.mode}`;
}

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
 * state-management-strategy Q12 — `state-changed` setting domain receiver.
 *
 * Backend `persist_setting("theme", …)` emits `{domain:"setting",
 * op:"update", entityId:"theme"}`. `dispatchStateChangedPayload` routes the
 * non-self-echo branch here. Refetch the canonical SQLite value via
 * `get_setting("theme")` and apply it through the underlying setter so
 * the LS-sync subscriber writes the FOUC cache.
 *
 * The refetch (rather than trusting the event payload) is the strategy doc
 * F.4 contract (lines 1391 and 1400): the event only notifies, and the
 * receiver refetches the actual value. It also keeps the receiver shape
 * uniform across all `setting` keys (theme / safe_mode / sidebar_width /
 * …): the dispatcher dispatches one `onUpdated`, the handler dispatches
 * per-key.
 */
/**
 * Per-entity `setting.update` refetch for the `theme` key. Exported so
 * the unified setting receiver (`src/lib/runtime/settings/settingsReceiver.ts`)
 * can delegate without having to know the parse / store internals.
 */
export async function applyThemeSettingFromBackend(): Promise<void> {
  const raw = await getSetting("theme");
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
