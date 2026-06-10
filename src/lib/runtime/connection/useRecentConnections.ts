import type { ConnectionConfig } from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";

export interface RecentConnectionViewModel {
  connectionId: string;
  lastUsed: number;
  conn: ConnectionConfig;
}

export function useRecentConnections(): {
  resolved: RecentConnectionViewModel[];
  removeRecent: (connectionId: string) => void;
} {
  const recentConnections = useMruStore((s) => s.recentConnections);
  const removeRecent = useMruStore((s) => s.removeRecentConnection);
  const connections = useConnectionStore((s) => s.connections);

  return {
    removeRecent,
    resolved: recentConnections
      .map((entry) => ({
        ...entry,
        conn: connections.find((c) => c.id === entry.connectionId),
      }))
      .filter((item): item is RecentConnectionViewModel => item.conn != null),
  };
}
