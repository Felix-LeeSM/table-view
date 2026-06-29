import { useState } from "react";
import { Loader2, Unplug } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import { useConnectionLifecycle } from "@/hooks/useConnectionLifecycle";
import { toast } from "@lib/runtime/toast";

/**
 * Workspace-toolbar control that drops the focused connection's adapter
 * pool.
 *
 * Behaviour:
 *   - Disabled when no connection is focused, when the focused
 *     connection is not in the `connected` variant, or while the
 *     button is mid-flight (a second click during disconnect could
 *     race the store update).
 *   - On click: invokes `disconnectFromDatabase(focusedConnId)` with a
 *     try/catch that surfaces the failure as a toast and re-enables the
 *     button so the user can retry. The store keeps the connection in
 *     `connected` on failure (the Tauri call rejected before the adapter
 *     pool was torn down).
 *   - Loading state shows a spinner instead of the unplug icon, and the
 *     aria-label flips to "Disconnecting…" so screen readers announce
 *     the in-flight state.
 */
export interface DisconnectButtonProps {
  /** Override for tests — defaults to "Disconnect". */
  ariaLabel?: string;
}

export default function DisconnectButton({
  ariaLabel,
}: DisconnectButtonProps = {}) {
  const { t } = useTranslation("workspace");
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const { disconnect: disconnectFromDatabase } = useConnectionLifecycle();
  const connections = useConnectionStore((s) => s.connections);

  const [busy, setBusy] = useState(false);

  const status = focusedConnId ? activeStatuses[focusedConnId] : undefined;
  const isConnected = status?.type === "connected";
  const disabled = !focusedConnId || !isConnected || busy;

  const focusedConn = focusedConnId
    ? connections.find((c) => c.id === focusedConnId)
    : undefined;
  const resolvedAriaLabel = ariaLabel ?? t("disconnect.ariaLabel");
  const tooltip = focusedConn
    ? t("disconnect.tooltip", { name: focusedConn.name })
    : t("disconnect.tooltipNoConn");

  const handleClick = async () => {
    if (!focusedConnId || !isConnected) return;
    setBusy(true);
    try {
      await disconnectFromDatabase(focusedConnId);
    } catch (e) {
      // The store propagates the Tauri rejection so callers can react;
      // the toast here is the user-facing surface. The button re-enables
      // automatically via `finally` below.
      toast.error(
        focusedConn
          ? t("disconnect.toastFailed", {
              name: focusedConn.name,
              error: String(e),
            })
          : t("disconnect.toastFailedNoConn", { error: String(e) }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      aria-label={busy ? t("disconnect.disconnecting") : resolvedAriaLabel}
      title={tooltip}
      data-busy={busy ? "true" : "false"}
      disabled={disabled}
      onClick={handleClick}
      className="text-muted-foreground hover:text-destructive disabled:opacity-40"
    >
      {busy ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : (
        <Unplug aria-hidden="true" />
      )}
    </Button>
  );
}
