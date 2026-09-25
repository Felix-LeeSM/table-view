/**
 * F.5 — "Disable history" toggle.
 *
 * User control for the `query_history_enabled` setting. ON (default) →
 * the 6 source callers invoke the `add_history_entry` IPC. OFF → the IPC
 * call path is 0 (the AC-373-03 spy invariant).
 *
 * UX:
 *   - A single button toggle (Power icon) — a click mutates the store
 *     immediately plus a fire-and-forget `persist_setting` IPC. The UI
 *     change lands ahead of any backend reject, so perceived latency is 0.
 *   - aria-pressed stays in sync with the truth — the accessibility test
 *     verifies user intent through this attribute.
 *   - The optional tooltip (`title=`) explains the behaviour change after
 *     disabling: "Disable → future queries are not recorded. Existing
 *     rows remain (Clear is separate)."
 *
 * Placement: the Settings area (the settings surface of HomePage /
 * launcher). No surface mounts the component yet.
 */

import { Button } from "@components/ui/button";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { Power, PowerOff } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function HistorySettings() {
  const { t } = useTranslation("settings");
  const enabled = useHistorySettingsStore((s) => s.queryHistoryEnabled);
  const setEnabled = useHistorySettingsStore((s) => s.setQueryHistoryEnabled);

  const Icon = enabled ? Power : PowerOff;
  // Toggling off plainly means "disable". The explicit enable/disable
  // label lives on the button itself, so both toggle states read clearly
  // to the user.
  const label = enabled
    ? t("historySettings.labelOn")
    : t("historySettings.labelOff");
  const tooltip = enabled
    ? t("historySettings.tooltipOn")
    : t("historySettings.tooltipOff");

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      aria-pressed={enabled ? "true" : "false"}
      data-testid="history-settings-toggle"
      data-enabled={enabled ? "true" : "false"}
      title={tooltip}
      onClick={() => {
        void setEnabled(!enabled);
      }}
    >
      <Icon
        className={`h-4 w-4 ${enabled ? "text-success" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="ml-1 text-xs">{label}</span>
    </Button>
  );
}
