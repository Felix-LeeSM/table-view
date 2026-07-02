/**
 * Sprint 373 (Phase 5 F.5) — query history settings store.
 *
 * 작성 2026-05-17. 두 사용자 preference 를 보관:
 *   1. `queryHistoryEnabled` (boolean) — "Disable history" 토글의 ON/OFF.
 *      `false` 로 가면 6 source caller 가 `add_history_entry` IPC 자체를
 *      호출 안 함 (AC-373-03). default `true`.
 *   2. `queryHistoryRetentionDays` (number) — 7 | 30 | 90 | 0 (forever).
 *      0 은 보존 무제한 — `boot_vacuum_old_history` 가 no-op. default 30.
 *
 * Settings 키:
 *   - `query_history_enabled`         — JSON `true` / `false`.
 *   - `query_history_retention_days`  — JSON number (정수).
 *
 * Pattern 은 safeModeStore (sprint-368) 와 동일:
 *   - 사용자 액션 → store mutate (optimistic) → `persist_setting` IPC.
 *     IPC reject 는 logger.warn 만; 다음 boot snapshot 이 truth 회복.
 *   - cross-window: backend `state-changed` (`setting:query_history_*:update`)
 *     → runtime settings receiver 가 본 store 의 `applyFromBackend` 를 호출 →
 *     `get_setting` refetch 로 store sync.
 *
 * 본 store 는 launcher / workspace 양 window 에 mount — 모든 caller 가
 * settings 를 즉시 selector 로 읽을 수 있어야 한다 (boot snapshot 도착 후
 * receiver 가 sync 함).
 */

import { create } from "zustand";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import { getSetting, persistSettingValue } from "@lib/tauri/settings";

/**
 * "forever" 보존을 0 로 인코딩. `boot_vacuum_old_history` 가 retention
 * <= 0 인 경우 no-op 으로 처리 (sprint-371 backend invariant).
 */
export type HistoryRetentionDays = 0 | 7 | 30 | 90;

export interface HistorySettingsState {
  /** "Disable history" 토글이 OFF 이면 true (= history 기록 활성화). */
  queryHistoryEnabled: boolean;
  /** 0 (forever) | 7 | 30 | 90 — 사용자가 select. */
  queryHistoryRetentionDays: HistoryRetentionDays;

  /** 사용자 토글 — optimistic store mutate + backend persist. */
  setQueryHistoryEnabled: (enabled: boolean) => Promise<void>;
  /** retention select — optimistic store mutate + backend persist. */
  setQueryHistoryRetentionDays: (days: HistoryRetentionDays) => Promise<void>;
}

/**
 * 사용자 신규 boot 의 default. AC-373-07 (30d) + AC-373-08 (enabled = true).
 * Boot snapshot 이 SQLite truth 와 sync 되기 전까지 store 가 본 값을 노출.
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
 * Cross-window setting receiver. runtime settings receiver 가 entityId 별
 * dispatch 할 때 본 함수가 두 키의 refetch + store sync 를 책임.
 *
 * `applyFromBackend` 는 backend `get_setting(key)` IPC 를 호출해서 JSON
 * 응답을 파싱 — null/unknown shape 은 silent skip (default 유지). 인자가
 * 없으면 두 키 모두 refetch.
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
    // 4 허용 값만 통과 — 그 외는 silent skip (사용자 SQLite tamper /
    // schema drift 대응).
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
