import { invoke } from "@tauri-apps/api/core";
import type {
  KvDatabaseInfo,
  KvDeleteRequest,
  KvKeyScanPage,
  KvKeyScanRequest,
  KvMutationResult,
  KvSetStringRequest,
  KvStreamReadRequest,
  KvStreamReadResult,
  KvTtlUpdateRequest,
  KvValueEnvelope,
  KvValueReadRequest,
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

export async function getKvValue(
  connectionId: string,
  request: KvValueReadRequest,
  queryId?: string,
): Promise<KvValueEnvelope> {
  return invoke<KvValueEnvelope>("get_kv_value", {
    connectionId,
    request,
    queryId,
  });
}

export async function setKvStringValue(
  connectionId: string,
  request: KvSetStringRequest,
): Promise<KvMutationResult> {
  return invoke<KvMutationResult>("set_kv_string_value", {
    connectionId,
    request,
  });
}

export async function deleteKvKey(
  connectionId: string,
  request: KvDeleteRequest,
): Promise<KvMutationResult> {
  return invoke<KvMutationResult>("delete_kv_key", {
    connectionId,
    request,
  });
}

export async function updateKvTtl(
  connectionId: string,
  request: KvTtlUpdateRequest,
): Promise<KvMutationResult> {
  return invoke<KvMutationResult>("update_kv_ttl", {
    connectionId,
    request,
  });
}

export async function readKvStream(
  connectionId: string,
  request: KvStreamReadRequest,
  queryId?: string,
): Promise<KvStreamReadResult> {
  return invoke<KvStreamReadResult>("read_kv_stream", {
    connectionId,
    request,
    queryId,
  });
}
