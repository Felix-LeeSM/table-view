/**
 * Query history settings store (state-management-strategy Phase 5 F.5).
 *
 * Written 2026-05-17. Holds two user preferences:
 *   1. `queryHistoryEnabled` (boolean) — ON/OFF state of the "Disable
 *      history" toggle. When it is `false`, the history source callers do
 *      not call the `add_history_entry` IPC at all (AC-373-03). Default
 *      `true`.
 *   2. `queryHistoryRetentionDays` (number) — 7 | 30 | 90 | 0 (forever).
 *      0 means unlimited retention — `boot_vacuum_old_history` is a no-op.
 *      Default 30.
 *
 * Settings keys:
 *   - `query_history_enabled`         — JSON `true` / `false`.
 *   - `query_history_retention_days`  — JSON number (integer).
 *
 * Pattern:
 *   - User action → store mutate (optimistic) → `persist_setting` IPC.
 *     An IPC reject logs `logger.warn` and shows an error toast.
 *   - Cross-window, the same route as safeModeStore: backend
 *     `state-changed` (`setting:query_history_*:update`) → the runtime
 *     settings receiver calls this store's `applyHistorySettingsFromBackend`
 *     → a `get_setting` refetch syncs the store.
 *
 * This store is mounted in both the launcher and the workspace window —
 * every caller must be able to read the settings through a selector right
 * away (the settings receiver keeps them in sync across windows).
 */

import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { getSetting, persistSettingValue } from "@lib/tauri/settings";
import { create } from "zustand";

/**
 * Encodes "forever" retention as 0. `boot_vacuum_old_history` treats a
 * retention <= 0 as a no-op (backend invariant).
 */
export type HistoryRetentionDays = 0 | 7 | 30 | 90;

export interface HistorySettingsState {
  /** true when the "Disable history" toggle is OFF (history is recorded). */
  queryHistoryEnabled: boolean;
  /** 0 (forever) | 7 | 30 | 90 — picked by the user. */
  queryHistoryRetentionDays: HistoryRetentionDays;

  /** User toggle — optimistic store mutate + backend persist. */
  setQueryHistoryEnabled: (enabled: boolean) => Promise<void>;
  /** retention select — optimistic store mutate + backend persist. */
  setQueryHistoryRetentionDays: (days: HistoryRetentionDays) => Promise<void>;
}

/**
 * Defaults on a fresh boot. AC-373-07 (30d) + AC-373-08 (enabled = true).
 * The boot snapshot does not hydrate this store, so these values hold until
 * a user action or a `setting.update` refetch replaces them.
 */
const DEFAULT_QUERY_HISTORY_ENABLED = true;
const DEFAULT_QUERY_HISTORY_RETENTION_DAYS: HistoryRetentionDays = 30;

export const useHistorySettingsStore = create<HistorySettingsState>()(
  (set) => ({
    queryHistoryEnabled: DEFAULT_QUERY_HISTORY_ENABLED,
    queryHistoryRetentionDays: DEFAULT_QUERY_HISTORY_RETENTION_DAYS,

    setQueryHistoryEnabled: async (enabled) => {
      // Optimistic — UI flips immediately. #1092 — SQLite is the SOT and the
      // boot snapshot re-reads it, so a failed write reverts the setting on
      // next boot; surface a dev log + error toast (no boot reconcile exists).
      set({ queryHistoryEnabled: enabled });
      try {
        await persistSettingValue("query_history_enabled", enabled);
      } catch (e) {
        logger.warn(
          "[historySettingsStore] setQueryHistoryEnabled persist_setting failed (UI already applied):",
          e instanceof Error ? e.message : e,
        );
        toast.error(i18n.t("feedback:storageWriteFailed"));
      }
    },

    setQueryHistoryRetentionDays: async (days) => {
      set({ queryHistoryRetentionDays: days });
      try {
        await persistSettingValue("query_history_retention_days", days);
      } catch (e) {
        logger.warn(
          "[historySettingsStore] setQueryHistoryRetentionDays persist_setting failed (UI already applied):",
          e instanceof Error ? e.message : e,
        );
        toast.error(i18n.t("feedback:storageWriteFailed"));
      }
    },
  }),
);

/**
 * Cross-window setting receiver. When the runtime settings receiver
 * dispatches by entityId, this function owns the refetch + store sync for
 * the two keys.
 *
 * `applyHistorySettingsFromBackend` calls the backend `get_setting(key)` IPC
 * and parses the JSON response — null or an unknown shape is skipped
 * silently (the store keeps its current value). With no argument it
 * refetches both keys.
 */
export async function applyHistorySettingsFromBackend(
  entityId?: string,
): Promise<void> {
  if (entityId === undefined || entityId === "query_history_enabled") {
    await refetchQueryHistoryEnabled();
  }
  if (entityId === undefined || entityId === "query_history_retention_days") {
    await refetchQueryHistoryRetentionDays();
  }
}

async function refetchQueryHistoryEnabled(): Promise<void> {
  try {
    const raw = await getSetting("query_history_enabled");
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "boolean") return;
    useHistorySettingsStore.setState({ queryHistoryEnabled: parsed });
  } catch (e) {
    logger.warn(
      "[historySettingsStore] refetch query_history_enabled failed:",
      e instanceof Error ? e.message : e,
    );
  }
}

async function refetchQueryHistoryRetentionDays(): Promise<void> {
  try {
    const raw = await getSetting("query_history_retention_days");
    if (raw === null) return;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "number") return;
    // Only the four allowed values pass — anything else is skipped silently
    // (guards against user tampering with SQLite / schema drift).
    if (parsed !== 0 && parsed !== 7 && parsed !== 30 && parsed !== 90) {
      return;
    }
    useHistorySettingsStore.setState({
      queryHistoryRetentionDays: parsed as HistoryRetentionDays,
    });
  } catch (e) {
    logger.warn(
      "[historySettingsStore] refetch query_history_retention_days failed:",
      e instanceof Error ? e.message : e,
    );
  }
}
