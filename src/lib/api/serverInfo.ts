// Sprint 339 (U4 live wire) — paradigm-neutral server identity panel.
// RDB → version() + pg_settings whitelist. Mongo → buildInfo + serverStatus.
// Both flatten into ServerInfoRow with paradigm-specific keys in extras.

import { invoke } from "@tauri-apps/api/core";

export interface ServerInfoRow {
  version: string;
  host: string | null;
  uptimeSec: number | null;
  connectionsActive: number | null;
  extras: Record<string, unknown>;
}

export async function serverInfo(connectionId: string): Promise<ServerInfoRow> {
  return invoke<ServerInfoRow>("server_info", { connectionId });
}
