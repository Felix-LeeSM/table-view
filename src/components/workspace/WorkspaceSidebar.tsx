import type { ReactNode } from "react";
import { Database, MousePointerClick, Plug } from "lucide-react";
import { Button } from "@components/ui/button";
import { useConnectionStore } from "@stores/connectionStore";
import { useTabStore } from "@stores/tabStore";
import { assertNever } from "@lib/paradigm";
import DocumentSidebar from "./DocumentSidebar";
import RdbSidebar from "./RdbSidebar";
import UnsupportedShellNotice from "./UnsupportedShellNotice";
import { pickSidebar, type SidebarKind } from "./pickSidebar";

export interface WorkspaceSidebarProps {
  /**
   * Fallback connection id used when no active tab is mounted (e.g. the
   * user just opened the workspace and hasn't focused a tab yet). Derived
   * from `useConnectionStore.focusedConnId` upstream — see
   * {@link Sidebar} where the prop is wired.
   */
  selectedId: string | null;
}

/**
 * Sprint 126 — paradigm-aware sidebar slot.
 *
 * Replaces the paradigm `if/else` previously baked into `SchemaPanel`
 * with a 4-way switch driven by `pickSidebar(paradigm)`. The "driving
 * connection" is resolved with active-tab priority:
 *
 *   1. If a tab is active and its `connectionId` resolves to a known
 *      connection, that connection wins. Switching tabs across paradigms
 *      (rdb ↔ mongo) the sidebar shell tracks the active document, not
 *      the historically "selected" connection in the connection store.
 *      Sprint 127+ multi-paradigm coexistence depends on this priority.
 *   2. Otherwise the prop `selectedId` (i.e. the focused connection) is
 *      used as a fallback so users who haven't opened a tab yet still
 *      see their focused connection's tree.
 *
 * Empty / connecting / error cards are also owned here — the messages
 * and icons are byte-for-byte identical to the previous `SchemaPanel`
 * states so the pure visual contract is preserved.
 */
export default function WorkspaceSidebar({
  selectedId,
}: WorkspaceSidebarProps) {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const connectToDatabase = useConnectionStore((s) => s.connectToDatabase);
  const activeTabConnId = useTabStore((s) => {
    const id = s.activeTabId;
    if (!id) return null;
    const tab = s.tabs.find((t) => t.id === id);
    return tab?.connectionId ?? null;
  });

  if (connections.length === 0) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <Database size={36} className="mb-3 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          No connections yet
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Switch to the Connections tab and add your first database
        </p>
      </div>
    );
  }

  // Active-tab priority resolution. We only honour the active tab's
  // connection id when that connection still exists in the store; if the
  // tab references a vanished connection we fall back to `selectedId`
  // rather than rendering an empty shell.
  const activeTabConn = activeTabConnId
    ? connections.find((c) => c.id === activeTabConnId)
    : null;
  const driving =
    activeTabConn ??
    (selectedId ? connections.find((c) => c.id === selectedId) : null);

  if (!selectedId && !activeTabConn) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <MousePointerClick size={28} className="mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          Select a connection
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick a connection from the Connections tab to view its schemas
        </p>
      </div>
    );
  }

  if (!driving) {
    // selectedId points at an unknown connection and there is no active
    // tab to fall back to — match SchemaPanel's previous "render nothing"
    // shape so existing snapshots / DOM expectations stay stable.
    return null;
  }

  const status = activeStatuses[driving.id];
  const isConnected = status?.type === "connected";
  const isConnecting = status?.type === "connecting";
  const isError = status?.type === "error";

  if (!isConnected) {
    return (
      <div
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center select-none"
        role="status"
      >
        <Plug size={28} className="mb-2 text-muted-foreground" />
        <p className="text-sm font-medium text-secondary-foreground">
          {driving.name}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {isConnecting ? (
            "Connecting…"
          ) : isError ? (
            `Failed to connect: ${status?.type === "error" ? status.message : ""}`
          ) : (
            <>
              Double-click in the Connections tab to connect, or{" "}
              <Button
                variant="link"
                className="h-auto p-0 text-xs"
                onClick={() => connectToDatabase(driving.id)}
              >
                connect now
              </Button>
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {renderKind(pickSidebar(driving.paradigm), driving.id)}
    </div>
  );
}

/**
 * Pure render helper. Kept outside the component so the paradigm switch
 * stays a single, exhaustive `switch` (no nested ternaries inline).
 * Adding a new {@link SidebarKind} surfaces here as a TS error via
 * `assertNever`.
 */
function renderKind(kind: SidebarKind, connectionId: string): ReactNode {
  switch (kind) {
    case "rdb":
      return <RdbSidebar connectionId={connectionId} />;
    case "document":
      return <DocumentSidebar connectionId={connectionId} />;
    case "kv":
      return <UnsupportedShellNotice paradigm="kv" />;
    case "search":
      return <UnsupportedShellNotice paradigm="search" />;
    default:
      return assertNever(kind);
  }
}
