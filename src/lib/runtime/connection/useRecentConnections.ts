import { useConnectionStore } from "@stores/connectionStore";
import { useMruStore } from "@stores/mruStore";
import type { ConnectionConfig } from "@/types/connection";

export interface RecentConnectionViewModel {
  connectionId: string;
  lastUsed: number;
  conn: ConnectionConfig;
}

export function useRecentConnections(): {
  resolved: RecentConnectionViewModel[];
  removeRecent: (connectionId: string) => void;
  clearRecent: () => void;
} {
  const recentConnections = useMruStore((s) => s.recentConnections);
  const removeRecent = useMruStore((s) => s.removeRecentConnection);
  // #2433 — the "clear all" affordance moved out of the launcher action bar
  // and into the foot of the Recent list, so it reaches the store through the
  // same use-case hook the list already uses instead of a second store read.
  const clearRecent = useMruStore((s) => s.clearRecentConnections);
  const connections = useConnectionStore((s) => s.connections);

  return {
    removeRecent,
    clearRecent,
    resolved: recentConnections
      .map((entry) => ({
        ...entry,
        conn: connections.find((c) => c.id === entry.connectionId),
      }))
      .filter((item): item is RecentConnectionViewModel => item.conn != null),
  };
}
