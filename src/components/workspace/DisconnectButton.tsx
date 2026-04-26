import { useState } from "react";
import { Loader2, Unplug } from "lucide-react";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import { toast } from "@lib/toast";

/**
 * Sprint 134 — DisconnectButton.
 *
 * Workspace-toolbar control that drops the focused connection's adapter
 * pool. Closes the gap left by sprints 127–133 where Workspace had
 * exactly zero in-app affordance for "stop talking to this database"
 * (the only paths were the sidebar context menu, which the lesson
 * 2026-04-27-workspace-toolbar-ux-gaps flagged as undiscoverable, and
 * quitting the app).
 *
 * Behaviour:
 *   - Disabled when no connection is focused, when the focused
 *     connection is not in the `connected` variant, or while the
 *     button is mid-flight (a second click during disconnect could
 *     race the store update).
 *   - On click: invokes `disconnectFromDatabase(focusedConnId)`, with
 *     a try/catch that surfaces the failure as a toast and re-enables
 *     the button so the user can retry. The store keeps the connection
 *     in `connected` on failure (the Tauri call rejected before the
 *     adapter pool was torn down).
 *   - Loading state shows a spinner instead of the unplug icon, and
 *     the aria-label flips to "Disconnecting…" so screen readers
 *     announce the in-flight state.
 *
 * Visual: ghost variant + icon-xs to match the DbSwitcher sibling
 * control in `WorkspaceToolbar` (Sprint 135 removed `SchemaSwitcher`).
 */
export interface DisconnectButtonProps {
  /** Override for tests — defaults to "Disconnect". */
  ariaLabel?: string;
}

export default function DisconnectButton({
  ariaLabel = "Disconnect",
}: DisconnectButtonProps = {}) {
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const disconnectFromDatabase = useConnectionStore(
    (s) => s.disconnectFromDatabase,
  );
  const connections = useConnectionStore((s) => s.connections);

  const [busy, setBusy] = useState(false);

  const status = focusedConnId ? activeStatuses[focusedConnId] : undefined;
  const isConnected = status?.type === "connected";
  const disabled = !focusedConnId || !isConnected || busy;

  const focusedConn = focusedConnId
    ? connections.find((c) => c.id === focusedConnId)
    : undefined;
  const tooltip = focusedConn
    ? `Disconnect from ${focusedConn.name}`
    : "Disconnect (no active connection)";

  const handleClick = async () => {
    if (!focusedConnId || !isConnected) return;
    setBusy(true);
    try {
      await disconnectFromDatabase(focusedConnId);
    } catch (e) {
      // Sprint 134 — disconnect failure path. The store does not
      // catch this rejection itself (it propagates the Tauri error so
      // callers can react), so we toast here. The button re-enables
      // automatically via the `finally` below.
      toast.error(
        `Failed to disconnect${focusedConn ? ` from "${focusedConn.name}"` : ""}: ${String(e)}`,
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
      aria-label={busy ? "Disconnecting…" : ariaLabel}
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
