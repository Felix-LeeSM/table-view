// Issue #1054 — resolves the "driving" connection for the workspace
// operations flyout (U1 ServerActivity / U4 ServerInfo / U5 SlowQuery).
// The driving connection is the active tab's connection if it is
// currently connected, else the focused connection if connected, else
// null. Returns null when the resolved connection has no `operations.*`
// capability at all so the toolbar entry and panel can both hide.
//
// The resolution mirrors `WorkspaceSidebar` (active-tab priority →
// focused) so the ops surface always targets the connection the user is
// looking at, never a stale MRU pick.

import { useConnectionStore } from "@stores/connectionStore";
// #1447 — sql-free active-tab read (only `connectionId` is consumed).
import { useActiveTabSansSql } from "@stores/workspaceStore";
import { getDataSourceProfile } from "@/types/dataSource";
import type {
  ConnectionConfig,
  DatabaseType,
} from "@/features/connection/model";

export interface OperationsConnection {
  connectionId: string;
  name: string;
  dbType: DatabaseType;
  environment: string | null;
  ops: {
    activity: boolean;
    serverInfo: boolean;
    slowQueries: boolean;
  };
}

export function useOperationsConnection(): OperationsConnection | null {
  const activeTab = useActiveTabSansSql();
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);

  const resolve = (id: string | null | undefined): ConnectionConfig | null => {
    if (!id) return null;
    const c = connections.find((x) => x.id === id);
    if (!c) return null;
    if (activeStatuses[c.id]?.type !== "connected") return null;
    return c;
  };

  const driving =
    resolve(activeTab?.connectionId) ?? resolve(focusedConnId) ?? null;

  if (!driving) return null;

  const capabilities = getDataSourceProfile(driving.dbType).capabilities
    .operations;
  if (
    !capabilities.activity &&
    !capabilities.serverInfo &&
    !capabilities.slowQueries
  ) {
    return null;
  }

  return {
    connectionId: driving.id,
    name: driving.name,
    dbType: driving.dbType,
    environment: driving.environment ?? null,
    ops: {
      activity: capabilities.activity,
      serverInfo: capabilities.serverInfo,
      slowQueries: capabilities.slowQueries,
    },
  };
}
