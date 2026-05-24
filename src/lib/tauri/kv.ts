import { invoke } from "@tauri-apps/api/core";
import type {
  KvDatabaseInfo,
  KvKeyScanPage,
  KvKeyScanRequest,
} from "@/types/kv";

export async function listKvDatabases(
  connectionId: string,
): Promise<KvDatabaseInfo[]> {
  return invoke<KvDatabaseInfo[]>("list_kv_databases", { connectionId });
}

export async function currentKvDatabase(connectionId: string): Promise<number> {
  return invoke<number>("current_kv_database", { connectionId });
}

export async function switchKvDatabase(
  connectionId: string,
  database: number,
): Promise<number> {
  return invoke<number>("switch_kv_database", { connectionId, database });
}

export async function scanKvKeys(
  connectionId: string,
  request: KvKeyScanRequest,
  queryId?: string,
): Promise<KvKeyScanPage> {
  return invoke<KvKeyScanPage>("scan_kv_keys", {
    connectionId,
    request,
    queryId,
  });
}
