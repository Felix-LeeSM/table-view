import { invoke } from "@tauri-apps/api/core";
import type { ConnectionConfig, ConnectionGroup } from "../types/connection";

export async function listConnections(): Promise<ConnectionConfig[]> {
  return invoke<ConnectionConfig[]>("list_connections");
}

export async function saveConnection(
  connection: ConnectionConfig,
  isNew: boolean,
): Promise<ConnectionConfig> {
  return invoke<ConnectionConfig>("save_connection", {
    connection,
    isNew,
  });
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

export async function testConnection(
  config: ConnectionConfig,
): Promise<string> {
  return invoke<string>("test_connection", { config });
}

export async function connectToDatabase(id: string): Promise<void> {
  return invoke("connect", { id });
}

export async function disconnectFromDatabase(id: string): Promise<void> {
  return invoke("disconnect", { id });
}

export async function listGroups(): Promise<ConnectionGroup[]> {
  return invoke<ConnectionGroup[]>("list_groups");
}

export async function saveGroup(
  group: ConnectionGroup,
  isNew: boolean,
): Promise<ConnectionGroup> {
  return invoke<ConnectionGroup>("save_group", { group, isNew });
}

export async function deleteGroup(id: string): Promise<void> {
  return invoke("delete_group", { id });
}

export async function moveConnectionToGroup(
  connectionId: string,
  groupId: string | null,
): Promise<void> {
  return invoke("move_connection_to_group", {
    connectionId,
    groupId,
  });
}
