import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import type { SafeMode } from "@/lib/safeMode";

// `SafeMode` type lives in `src/lib/safeMode.ts` so the pure decision
// matrix can reference it without dragging a store dep into the lib
// layer. Re-exported here for the existing import path.
export type { SafeMode };

export interface SafeModeState {
  mode: SafeMode;
  // Sprint 368 (Phase 4 Q12) — backend-first. `setMode` / `toggle` invoke
  // `persist_setting("safe_mode", JSON)` and mutate the store only after
  // the IPC resolves. LS write 0 — `safeMode` is not FOUC critical; the
  // boot snapshot (sprint-367) supplies SQLite truth on the next load,
  // and the receiver path keeps live windows in sync.
  setMode: (next: SafeMode) => Promise<void>;
  toggle: () => Promise<void>;
}

/**
 * Phase 4 retire (sprint-368) — the `view-table.safeMode` LS key is no
 * longer written. The constant survives so existing tests that explicitly
 * clear / inspect it (e.g. `SafeModeToggle.test.tsx`) compile, but the
 * runtime path never touches it. Phase 6 cleanup removes the constant
 * + any remaining read sites.
 */
export const SAFE_MODE_STORAGE_KEY = "view-table.safeMode";

// Toggle order strict → warn → off → strict. The warn step is mandatory:
// going strict→off in one click would silently disable the guard.
const NEXT_MODE: Record<SafeMode, SafeMode> = {
  strict: "warn",
  warn: "off",
  off: "strict",
};

/**
 * Sprint 368 (Phase 4 Q12) — backend-first safe-mode persistence helper.
 *
 * Wraps `persist_setting("safe_mode", JSON.stringify(mode))` so both
 * actions (`setMode` / `toggle`) funnel through the same IPC call site.
 * The `valueJson` field is the strategy F.4 wire shape — a bare string
 * literal (`"strict"` / `"warn"` / `"off"`), not an object, because
 * safeMode has no nested structure.
 */
async function persistSafeModeSetting(mode: SafeMode): Promise<void> {
  await invoke("persist_setting", {
    req: {
      key: "safe_mode",
      valueJson: JSON.stringify(mode),
    },
  });
}

export const useSafeModeStore = create<SafeModeState>()((set, get) => ({
  mode: "strict",

  setMode: async (next) => {
    await persistSafeModeSetting(next);
    set({ mode: next });
  },

  toggle: async () => {
    const next = NEXT_MODE[get().mode];
    await persistSafeModeSetting(next);
    set({ mode: next });
  },
}));

/**
 * Cross-window broadcast allowlist. Only `mode` is sync-safe; the
 * action functions are local and must never be broadcast.
 */
export const SYNCED_KEYS: ReadonlyArray<keyof SafeModeState> = [
  "mode",
] as const;

void attachZustandIpcBridge<SafeModeState>(useSafeModeStore, {
  channel: "safe-mode-sync",
  syncKeys: SYNCED_KEYS,
  originId: getCurrentWindowLabel() ?? "unknown",
}).catch(() => {
  // best-effort: see mruStore.ts rationale.
});

/**
 * Per-entity `setting.update` refetch for the `safe_mode` key. Exported
 * so the unified setting receiver (`src/lib/runtime/settings/settingsReceiver.ts`)
 * can delegate without having to know the parse / store internals.
 */
export async function applySafeModeSettingFromBackend(): Promise<void> {
  const raw = await invoke<string | null>("get_setting", { key: "safe_mode" });
  if (raw === null) return;
  const parsed = parseSafeModeSettingValue(raw);
  if (parsed === null) return;
  useSafeModeStore.setState({ mode: parsed });
}

function parseSafeModeSettingValue(raw: string): SafeMode | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === "strict" || parsed === "warn" || parsed === "off") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
