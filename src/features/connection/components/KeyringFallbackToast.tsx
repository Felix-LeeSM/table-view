/**
 * One-time notice toast (Q22) shown where the Linux Secret Service / kwallet
 * is unavailable (AC-356-05).
 *
 * Shown when:
 *   - `fallbackActive == true`: the backend's `KeySource::DiskFallback`
 *     signal.
 *   - `dismissed == false`: the user has not dismissed it on an earlier boot
 *     (no `.keyring-fallback-dismissed` file sidecar).
 *
 * Dismiss:
 *   - The user clicks "Dismiss" → the toast hides immediately and the IPC
 *     sets the file sidecar.
 *   - The UI hides even when the IPC fails (best-effort; if the next boot runs
 *     in the same environment the toast reappears and the user can dismiss it
 *     again).
 *
 * This component is an inline alert, not a toast container — `Toaster()` may
 * not be mounted at boot (before frontend store hydration), so it is meant to
 * mount inside ConnectionList / Launcher to show reliably on the first paint
 * after boot. Nothing mounts it yet — only `KeyringFallbackToast.test.tsx`
 * renders it. The scope is display, dismiss, and the sentinel write.
 *
 * The "Why?" link is out of scope (`docs/security/keyring-fallback.md` does
 * not exist yet); a follow-up is planned to add it.
 */

import { logger } from "@lib/logger";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FOCUS_RING_BORDERLESS } from "@/components/ui/focusRing";
import { setKeyringFallbackDismissed } from "@/lib/keyringFallback";
import { cn } from "@/lib/utils";

export interface KeyringFallbackToastProps {
  /** Set when the backend `migrate_or_initialize()` reports
   *  `fallback_to_disk = true`. */
  fallbackActive: boolean;
  /** Whether the file sidecar `.keyring-fallback-dismissed` exists. */
  dismissed: boolean;
}

export function KeyringFallbackToast({
  fallbackActive,
  dismissed,
}: KeyringFallbackToastProps) {
  const { t } = useTranslation("featuresConnection");
  // Local override so a click hides the toast immediately, without waiting
  // for a parent rerender after the IPC sentinel write resolves.
  const [hidden, setHidden] = useState(false);

  if (!fallbackActive || dismissed || hidden) {
    return null;
  }

  const handleDismiss = async () => {
    setHidden(true);
    try {
      await setKeyringFallbackDismissed();
    } catch (err) {
      // Best-effort sentinel write. If the backend / file write fails, we
      // still hide the UI for this session — the next boot re-evaluates
      // and the user can dismiss again. Log so devs spot persistent
      // failures.
      logger.warn("keyring fallback dismiss IPC failed", err);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-slot="keyring-fallback-toast"
      className={cn(
        "pointer-events-auto m-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning shadow-sm",
      )}
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{t("keyring.title")}</div>
        <p className="mt-1 text-xs opacity-90">{t("keyring.body")}</p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label={t("keyring.dismissAria")}
        className={`ml-1 inline-flex shrink-0 cursor-pointer rounded-sm p-0.5 opacity-70 outline-none hover:opacity-100 ${FOCUS_RING_BORDERLESS}`}
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
