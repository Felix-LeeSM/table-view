/**
 * Unified `state-changed` setting receiver (Q12).
 *
 * The dispatcher (`stateChanged.ts`) registers exactly one
 * `setting.onUpdated` callback per process — shallow-merging multiple
 * registrations would silently drop the earlier one. Each store that
 * owns a `setting` key (theme / safe_mode / future sidebar_width …)
 * therefore exposes a pure `apply*FromBackend()` helper, and this single
 * receiver dispatches based on `entityId` (= the settings key).
 *
 * Wiring (production, idempotent): `registerSettingReceiver()` is called
 * once during boot from `src/main.tsx` before the `state-changed`
 * listener is registered. Tests can call it from a `beforeEach` after
 * `resetStateChangedRegistryForTests()` without re-running module-load
 * side effects.
 *
 * Strategy F.4 line 1388 — `setting.update` payloads carry the settings
 * key in `entityId`; the actual value is fetched via `get_setting(key)`
 * (the event is a notification, not a payload). `reset` is out of scope
 * for this receiver (the dispatcher already separates `onUpdated` from
 * `onReset` per strategy line 1389).
 */

import { setStateChangedHandlers } from "@lib/events/stateChanged";
import { applyHistorySettingsFromBackend } from "@stores/historySettingsStore";
import { applySafeModeSettingFromBackend } from "@stores/safeModeStore";
import { applyThemeSettingFromBackend } from "@stores/themeStore";

let registered = false;

/**
 * Register the singleton `setting.onUpdated` handler. Idempotent — repeat
 * calls are no-ops so production boot can call it unconditionally and
 * tests can re-register after a registry reset.
 */
export function registerSettingReceiver(): void {
  if (registered) return;
  registered = true;
  setStateChangedHandlers({
    setting: {
      onUpdated: (entityId) => {
        void dispatchSettingUpdate(entityId);
      },
    },
  });
}

/**
 * Vitest-only escape hatch — clears the `registered` guard so the next
 * `registerSettingReceiver()` call re-registers the handler. Pair with
 * `resetStateChangedRegistryForTests()` between cases.
 */
export function resetSettingReceiverForTests(): void {
  registered = false;
}

async function dispatchSettingUpdate(entityId: string): Promise<void> {
  try {
    if (entityId === "theme") {
      await applyThemeSettingFromBackend();
    } else if (entityId === "safe_mode") {
      await applySafeModeSettingFromBackend();
    } else if (
      entityId === "query_history_enabled" ||
      entityId === "query_history_retention_days"
    ) {
      // Query history toggle + retention select.
      // Both keys route through the same dispatcher so cross-window
      // HistorySettings state stays coherent.
      await applyHistorySettingsFromBackend(entityId);
    }
    // Other keys (sidebar_width, home_recent_collapsed, …) have no branch
    // here. The dispatcher routes every `setting` update to this singleton
    // receiver, so an unknown key is a silent no-op.
  } catch {
    // best-effort — see store comments. The next event will retry; the
    // boot snapshot is the recovery path.
  }
}
