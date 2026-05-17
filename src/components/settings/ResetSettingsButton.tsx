/**
 * Sprint 376 (Phase 6 Q21) — Settings panel reset affordance.
 *
 * Two adjacent buttons covering Q21 9-affordance entries #1 and #3-b:
 *   - "Reset settings" — 4 keys: theme / safe_mode /
 *     query_history_retention_days / query_history_enabled. Each fires
 *     `reset_setting(key)` (frontend wrapper at @lib/tauri/settings).
 *   - "Reset sidebar width" — single key `sidebar_width`. The same
 *     contract is reachable from a Sidebar handle context-menu entry
 *     (#3-a, see Sidebar.tsx) so users with mouse-only navigation can
 *     find at least one path.
 *
 * Q21 contract: no confirm dialog — each click fires the IPC directly.
 * Strategy doc line 1389: backend deletes the SQLite row and emits
 * `state-changed { domain:"setting", op:"reset", entityId: key }`;
 * receivers DO NOT refetch, they apply the frontend
 * `SETTING_DEFAULTS[entityId]` constant. Caller doesn't need any
 * follow-up persist — the local window's existing
 * `settingsReceiver`/store handler reads the default on its own.
 */

import { RotateCcw, RectangleHorizontal } from "lucide-react";
import { Button } from "@components/ui/button";
import { resetSetting } from "@lib/tauri/settings";
import { logger } from "@lib/logger";

/**
 * The four global setting keys covered by the "Reset settings" button.
 * Exported so tests and downstream audit tooling assert the exact set —
 * if a future sprint adds a new global setting, this list MUST grow and
 * the Q21 audit checklist gets a new affordance entry.
 */
export const RESET_SETTINGS_KEYS = [
  "theme",
  "safe_mode",
  "query_history_retention_days",
  "query_history_enabled",
] as const;

export const RESET_SIDEBAR_WIDTH_KEY = "sidebar_width";

export interface ResetSettingsButtonProps {
  /**
   * Optional className passthrough so callers can position the buttons
   * inside their settings shell. The component itself stays unstyled
   * beyond shadcn `Button`'s defaults so it composes with whatever
   * surface mounts it (HomePage footer, future SettingsPage, etc.).
   */
  className?: string;
}

export default function ResetSettingsButton({
  className,
}: ResetSettingsButtonProps) {
  const handleResetAll = () => {
    // Fire 4 independent IPCs. The order is unspecified by the Q21
    // contract — each row is deleted independently and a missing key
    // is a backend no-op (idempotent). We call all four unconditionally
    // so a partially-set user (e.g. only `theme` was ever persisted)
    // still gets a consistent "all four are now default" outcome.
    for (const key of RESET_SETTINGS_KEYS) {
      void resetSetting(key).catch((e: unknown) => {
        const message = e instanceof Error ? e.message : String(e ?? "");
        logger.warn(
          `[ResetSettingsButton] reset_setting(${key}) failed: ${message}`,
        );
      });
    }
  };

  const handleResetSidebarWidth = () => {
    void resetSetting(RESET_SIDEBAR_WIDTH_KEY).catch((e: unknown) => {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(
        `[ResetSettingsButton] reset_setting(${RESET_SIDEBAR_WIDTH_KEY}) failed: ${message}`,
      );
    });
  };

  return (
    <div
      className={className}
      data-testid="reset-settings-buttons"
      // Sprint 376 — Settings panel section anchor. Q21 audit doc points
      // to `data-testid="reset-settings-buttons"` for e2e wiring.
    >
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={handleResetAll}
        aria-label="Reset settings"
        data-testid="reset-settings-all-button"
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        <span className="ml-1">Reset settings</span>
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={handleResetSidebarWidth}
        aria-label="Reset sidebar width"
        data-testid="reset-sidebar-width-button"
      >
        <RectangleHorizontal className="h-4 w-4" aria-hidden="true" />
        <span className="ml-1">Reset sidebar width</span>
      </Button>
    </div>
  );
}
