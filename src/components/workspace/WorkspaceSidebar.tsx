import type { ReactNode } from "react";
import { Database, MousePointerClick, Plug } from "lucide-react";
import { Button } from "@components/ui/button";
import { Skeleton } from "@components/ui/skeleton";
import { useConnectionStore } from "@stores/connectionStore";
import { useActiveTab } from "@stores/workspaceStore";
import { useConnectionLifecycle } from "@/hooks/useConnectionLifecycle";
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
 * Paradigm-aware sidebar slot. 4-way switch driven by
 * `pickSidebar(paradigm)`. The "driving connection" is resolved with
 * active-tab priority:
 *
 *   1. If a tab is active and its `connectionId` resolves to a known
 *      connection, that connection wins. Switching tabs across paradigms
 *      (rdb ↔ mongo) the sidebar shell tracks the active document, not
 *      the "selected" connection in the connection store. Multi-paradigm
 *      coexistence depends on this priority.
 *   2. Otherwise the `selectedId` prop (focused connection) is used so
 *      users who haven't opened a tab yet still see their focused
 *      connection's tree.
 *
 * Empty / connecting / error cards are owned here.
 */
export default function WorkspaceSidebar({
  selectedId,
}: WorkspaceSidebarProps) {
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const hasLoadedOnce = useConnectionStore((s) => s.hasLoadedOnce);
  const { connect: connectToDatabase } = useConnectionLifecycle();
  const activeTab = useActiveTab();
  const activeTabConnId = activeTab?.connectionId ?? null;

  if (connections.length === 0) {
    // Sprint 270 — pre-hydrate window: `loadConnections` hasn't resolved
    // yet, so we don't know whether the user actually has zero connections
    // or we just haven't fetched them. Show a skeleton instead of the
    // "No connections yet" card to avoid the empty-card flash on cold
    // boot. Once `hasLoadedOnce` flips, the existing empty card takes over.
    if (!hasLoadedOnce) {
      return <WorkspaceSidebarSkeleton />;
    }
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
 * Sprint 270 — first-paint skeleton for the sidebar. Renders four stacked
 * `Skeleton` rows roughly the height of a connection-list row. `role="status"`
 * + `aria-busy="true"` mirror the rest of the sidebar's empty / error cards
 * so screen readers know the surface is loading rather than empty. The
 * pre-hydrate window is usually < 200 ms, but on a cold-boot workspace
 * remount or a slow IPC it gives the user visible activity instead of a
 * blank column.
 */
function WorkspaceSidebarSkeleton(): ReactNode {
  return (
    <div
      className="flex flex-1 flex-col gap-2 px-4 py-4"
      role="status"
      aria-busy="true"
      aria-label="Loading connections"
      data-testid="workspace-sidebar-skeleton"
    >
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-4/5" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-4/5" />
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
