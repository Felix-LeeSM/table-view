import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";
import type { SafeMode } from "@/lib/safeMode";

// `SafeMode` type lives in `src/lib/safeMode.ts` so the pure decision
// matrix can reference it without dragging a store dep into the lib
// layer. Re-exported here for the existing import path.
export type { SafeMode };

export interface SafeModeState {
  mode: SafeMode;
  setMode: (next: SafeMode) => void;
  toggle: () => void;
}

export const SAFE_MODE_STORAGE_KEY = "view-table.safeMode";

// Toggle order strict → warn → off → strict. The warn step is mandatory:
// going strict→off in one click would silently disable the guard.
const NEXT_MODE: Record<SafeMode, SafeMode> = {
  strict: "warn",
  warn: "off",
  off: "strict",
};

export const useSafeModeStore = create<SafeModeState>()(
  persist(
    (set, get) => ({
      mode: "strict",
      setMode: (next) => set({ mode: next }),
      toggle: () => set({ mode: NEXT_MODE[get().mode] }),
    }),
    {
      name: SAFE_MODE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode }),
    },
  ),
);

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
