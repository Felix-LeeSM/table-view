import { useState } from "react";
import { useConnectionStore } from "../stores/connectionStore";
import ConnectionItem, { draggedConnectionId } from "./ConnectionItem";
import ConnectionGroup from "./ConnectionGroup";

export default function ConnectionList() {
  const connections = useConnectionStore((s) => s.connections);
  const groups = useConnectionStore((s) => s.groups);
  const moveConnectionToGroup = useConnectionStore(
    (s) => s.moveConnectionToGroup,
  );
  const [dropActive, setDropActive] = useState(false);

  const rootConnections = connections.filter((c) => !c.group_id);
  const groupedConnections = groups.map((group) => ({
    group,
    connections: connections.filter((c) => c.group_id === group.id),
  }));

  return (
    <div
      className={`py-1 ${dropActive ? "bg-(--color-accent)/5" : ""}`}
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
        <ConnectionItem key={conn.id} connection={conn} />
      ))}

      {/* Grouped connections */}
      {groupedConnections.map(({ group, connections: groupConns }) => (
        <ConnectionGroup
          key={group.id}
          group={group}
          connections={groupConns}
        />
      ))}
    </div>
  );
}
