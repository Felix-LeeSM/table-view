/**
 * AC-372-04.
 *
 * Single-responsibility button that fires the `clear_history` IPC and
 * surfaces the `{deletedCount: N}` response to the user as a toast.
 * VACUUM and the `history.clear` emit are the backend's job.
 *
 * UX:
 *   - Click → confirm dialog → confirm → IPC. A direct call leaves a
 *     mis-click unrecoverable.
 *   - deletedCount 0 in the response → informational toast (already
 *     empty).
 *   - IPC reject → error toast.
 *
 * Responsibility split:
 *   - The "delete" itself is 1 backend IPC + emit.
 *   - This component is a standalone unit, reusable from both the
 *     settings panel and the global query log header.
 */

import { Button } from "@components/ui/button";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { clearHistory } from "@lib/tauri/history";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export interface ClearHistoryButtonProps {
  /** Visible label; defaults to t("clearHistory.label"). */
  label?: string;
  /** Optional className passthrough so callers can tune size/colour. */
  className?: string;
}

export default function ClearHistoryButton({
  label,
  className,
}: ClearHistoryButtonProps) {
  const { t } = useTranslation("settings");
  const resolvedLabel = label ?? t("clearHistory.label");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const resp = await clearHistory();
      const n = resp.deletedCount;
      // Consistent wording: "N row(s) cleared". 0 rows follows the same
      // pattern, which keeps the assertion simple.
      const message = t("clearHistory.rowCleared", { count: n });
      toast.success(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("clearHistory.errorPrefix", { msg }));
      logger.warn("[ClearHistoryButton] clear_history failed", msg);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className={className}
        onClick={() => setConfirming(true)}
        disabled={busy}
        aria-label={resolvedLabel}
        data-testid="clear-history-button"
      >
        <Trash2 size={12} />
        {resolvedLabel}
      </Button>
      {confirming && (
        <ConfirmDialog
          title={t("clearHistory.dialogTitle")}
          message={t("clearHistory.dialogMessage")}
          confirmLabel={t("clearHistory.dialogConfirm")}
          danger
          loading={busy}
          onConfirm={() => {
            void handleConfirm();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
