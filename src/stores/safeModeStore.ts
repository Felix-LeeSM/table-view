import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { attachZustandIpcBridge } from "@lib/zustand-ipc-bridge";
import { getCurrentWindowLabel } from "@lib/window-label";

export type SafeMode = "strict" | "off";

export interface SafeModeState {
  mode: SafeMode;
  setMode: (next: SafeMode) => void;
  toggle: () => void;
}

export const SAFE_MODE_STORAGE_KEY = "view-table.safeMode";

export const useSafeModeStore = create<SafeModeState>()(
  persist(
    (set, get) => ({
      mode: "strict",
      setMode: (next) => set({ mode: next }),
      toggle: () => set({ mode: get().mode === "strict" ? "off" : "strict" }),
    }),
    {
      name: SAFE_MODE_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ mode: state.mode }),
    },
  ),
);

/**
 * Sprint 185 — cross-window broadcast allowlist for safe-mode store.
 * Only `mode` is sync-safe. Functions (`setMode`, `toggle`) are local
 * actions and must never be broadcast.
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
