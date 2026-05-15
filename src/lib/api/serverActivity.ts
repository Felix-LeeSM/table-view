// Sprint 336 (U1 live wire) — paradigm-neutral server activity feed +
// kill. PG → pg_stat_activity / pg_terminate_backend, Mongo → currentOp /
// killOp. Wire shape `ServerActivityRow` is identical for both paradigms.

import { invoke } from "@tauri-apps/api/core";

export interface ServerActivityRow {
  id: number;
  db: string | null;
  user: string | null;
  state: string | null;
  query: string | null;
  waitEvent: string | null;
  startedAt: string | null;
}

export async function listServerActivity(
  connectionId: string,
): Promise<ServerActivityRow[]> {
  return invoke<ServerActivityRow[]>("list_server_activity", { connectionId });
}

export async function killServerActivity(
  connectionId: string,
  id: number,
): Promise<void> {
  return invoke<void>("kill_server_activity", { connectionId, id });
}
