/**
 * Sprint 368 (Phase 4 Q12) — unified `state-changed` setting receiver.
 *
 * The sprint-365 dispatcher (`stateChanged.ts`) registers exactly one
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
 * for sprint-368 (sprint-372 owns the reset receiver for `theme` /
 * `safe_mode`; the dispatcher already separates `onUpdated` from
 * `onReset` per strategy line 1389).
 */

import { setStateChangedHandlers } from "@lib/events/stateChanged";
import { applyThemeSettingFromBackend } from "@stores/themeStore";
import { applySafeModeSettingFromBackend } from "@stores/safeModeStore";

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
    }
    // Other keys (sidebar_width, home_recent_collapsed, …) are handled
    // by other sprints' receivers. The dispatcher route arrives here
    // only because both stores register through the same singleton, so
    // an unknown key is a silent no-op — its real owner will receive
    // the same event in parallel.
  } catch {
    // best-effort — see store comments. The next event will retry; the
    // boot snapshot is the recovery path.
  }
}
