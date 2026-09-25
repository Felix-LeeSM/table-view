/**
 * #1566 — "Reveal logs" button.
 *
 * Fires the `open_log_dir` IPC to open the diagnostic log folder (the
 * #1599 file sink) in the OS file explorer. A support affordance so a
 * non-developer user can attach logs to a bug report without hunting
 * down the platform data dir path.
 *
 * UX: click → IPC. Success is self-evident from the explorer opening, so
 * no toast. Failure (no file explorer / IO) surfaces as an error toast
 * rather than staying silent.
 *
 * Reuses the standalone settings-button pattern of `ClearHistoryButton`
 * — usable from any settings surface, the launcher footer included.
 */

import { Button } from "@components/ui/button";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { openLogDir } from "@lib/tauri/diagnostics";
import { FolderOpen } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface RevealLogsButtonProps {
  /** Optional className passthrough so callers can tune size/layout. */
  className?: string;
}

export default function RevealLogsButton({ className }: RevealLogsButtonProps) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await openLogDir();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("revealLogs.errorPrefix", { msg }));
      logger.warn("[RevealLogsButton] open_log_dir failed", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      className={className}
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={t("revealLogs.label")}
      data-testid="reveal-logs-button"
    >
      <FolderOpen size={12} />
      {t("revealLogs.label")}
    </Button>
  );
}
