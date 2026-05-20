import { useCallback } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { openWorkspaceWindow } from "@lib/tauri/window";
import { logger } from "@lib/logger";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import ConnectionGroup from "./ConnectionGroup";
import { Database, GripVertical } from "lucide-react";

interface ConnectionListProps {
  environmentFilter?: string | null;
  /** Currently focused connection. Drives the selected ring on items. */
  selectedId?: string | null;
  /** Single-click selects a connection without connecting. */
  onSelect?: (id: string) => void;
  /** Fired after a successful double-click connect, so the parent can react. */
  onActivate?: (id: string) => void;
}

export default function ConnectionList({
  environmentFilter = null,
  selectedId = null,
  onSelect,
  onActivate,
}: ConnectionListProps) {
  const allConnections = useConnectionStore((s) => s.connections);
  const groups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );

  // Sprint 363 (Phase 3, Q13) — connection double-click 시 per-conn
  // workspace window 를 open/focus 한다. 같은 conn 두 번째 클릭은
  // backend (`open_workspace_window_inner`) 가 idempotent 하게 처리해서
  // 기존 `workspace-{conn_id}` 윈도우만 focus 한다 (sprint-361 잠금).
  // IPC 실패 시 toast 가 아닌 console.warn — 상위 onActivate 가 별도로
  // store/UI 처리를 수행한다.
  const handleActivate = useCallback(
    (id: string) => {
      // Fire-and-forget: window open IPC. The parent's `onActivate` is
      // invoked synchronously so store-side state (focused conn, stale
      // tab cleanup) lands without waiting for the OS-level window
      // creation.
      void openWorkspaceWindow(id).catch((e) => {
        logger.warn(
          `[connection-list] openWorkspaceWindow(${id}) failed:`,
          e instanceof Error ? e.message : e,
        );
      });
      onActivate?.(id);
    },
    [onActivate],
  );

  const connections = environmentFilter
    ? allConnections.filter((c) => c.environment === environmentFilter)
    : allConnections;

  const rootConnections = connections.filter((c) => !c.groupId);
  const groupedConnections = groups.map((group) => ({
    group,
    connections: connections.filter((c) => c.groupId === group.id),
  }));

  return (
    <div
      data-testid="connection-list-root"
      aria-label="Ungrouped connections drop area"
      className="flex min-h-full flex-col py-1 select-none"
      onDragOver={(e) => {
        if (!draggedConnectionId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={async (e) => {
        e.preventDefault();
        const connId =
          draggedConnectionId ?? e.dataTransfer.getData("text/plain");
        if (connId) {
          await moveConnectionToGroup(connId, null);
        }
      }}
    >
      {/* Root-level connections */}
      {rootConnections.map((conn) => (
        <ConnectionItem
          key={conn.id}
          connection={conn}
          selected={selectedId === conn.id}
          onSelect={onSelect}
          onActivate={handleActivate}
        />
      ))}

      {/* Grouped connections */}
      {groupedConnections.map(({ group, connections: groupConns }) => (
        <ConnectionGroup
          key={group.id}
          group={group}
          connections={groupConns}
          selectedId={selectedId}
          onSelect={onSelect}
          onActivate={handleActivate}
        />
      ))}

      {/* Group hint — show only when there are connections but no groups */}
      {allConnections.length > 0 && groups.length === 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-3xs text-muted-foreground opacity-60">
          <GripVertical size={10} />
          <span>Drag connections onto each other to create groups</span>
        </div>
      )}

      {/* Empty state — visible only when there are no connections at all */}
      {allConnections.length === 0 && (
        <div
          className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center"
          role="status"
        >
          <Database size={32} className="mb-3 text-muted-foreground" />
          <p className="text-sm font-medium text-secondary-foreground">
            No connections yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Click the + button to add your first database
          </p>
        </div>
      )}
    </div>
  );
}
