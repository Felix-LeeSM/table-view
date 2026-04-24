import { useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import ConnectionGroup from "./ConnectionGroup";
import { Database, GripVertical, FolderX } from "lucide-react";

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
  const [dropActive, setDropActive] = useState(false);

  const connections = environmentFilter
    ? allConnections.filter((c) => c.environment === environmentFilter)
    : allConnections;

  const rootConnections = connections.filter((c) => !c.group_id);
  const groupedConnections = groups.map((group) => ({
    group,
    connections: connections.filter((c) => c.group_id === group.id),
  }));

  return (
    <div
      data-testid="connection-list-root"
      aria-label="Ungrouped connections drop area"
      className={`flex min-h-full flex-col py-1 select-none transition-colors ${
        dropActive
          ? "bg-primary/5 outline outline-2 outline-dashed outline-primary/60 -outline-offset-2"
          : ""
      }`}
      onDragOver={(e) => {
        if (draggedConnectionId) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={async (e) => {
        e.preventDefault();
        setDropActive(false);
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
          onActivate={onActivate}
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
          onActivate={onActivate}
        />
      ))}

      {/* Explicit drop target hint — visible while the user is dragging a
          connection out of a group. Without it, the bg tint alone is too
          subtle to read as "drop here to ungroup" (Sprint 78 AC-04). */}
      {dropActive && (
        <div
          data-testid="ungrouped-drop-hint"
          role="status"
          aria-live="polite"
          className="mt-2 mx-3 flex items-center gap-2 rounded-md border border-dashed border-primary/60 bg-primary/10 px-3 py-2 text-xs font-medium text-primary"
        >
          <FolderX size={14} />
          <span>Drop here to remove from group</span>
        </div>
      )}

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
