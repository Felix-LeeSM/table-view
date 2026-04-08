import { useConnectionStore } from "../stores/connectionStore";
import ConnectionItem from "./ConnectionItem";
import ConnectionGroup from "./ConnectionGroup";

export default function ConnectionList() {
  const connections = useConnectionStore((s) => s.connections);
  const groups = useConnectionStore((s) => s.groups);

  const rootConnections = connections.filter((c) => !c.group_id);
  const groupedConnections = groups.map((group) => ({
    group,
    connections: connections.filter((c) => c.group_id === group.id),
  }));

  return (
    <div className="py-1">
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
