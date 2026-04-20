import { useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import ConnectionGroup from "./ConnectionGroup";
import { GripVertical } from "lucide-react";

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
      className={`py-1 select-none ${dropActive ? "bg-primary/5" : ""}`}
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

      {/* Group hint — show only when there are connections but no groups */}
      {allConnections.length > 0 && groups.length === 0 && (
        <div className="flex items-center gap-1.5 px-3 py-2 text-[10px] text-muted-foreground opacity-60">
          <GripVertical size={10} />
          <span>Drag connections onto each other to create groups</span>
        </div>
      )}
    </div>
  );
}
