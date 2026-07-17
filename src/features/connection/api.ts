import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionConfig,
  ConnectionDraft,
  ConnectionGroup,
} from "./model";
import { normalizeConnectionConfig } from "@lib/wireCamelCase";

export async function listConnections(): Promise<ConnectionConfig[]> {
  const connections = await invoke<unknown[]>("list_connections");
  return connections.map(normalizeConnectionConfig);
}

/**
 * Save a connection. The `draft` carries everything except `password`, which
 * has its own three-way semantics: `null` → keep existing, `""` → clear,
 * non-empty → set new. The backend never echoes the password back.
 */
export async function saveConnection(
  draft: ConnectionDraft,
  isNew: boolean,
): Promise<ConnectionConfig> {
  // `walletPassword` (#1065) has its own three-way semantics like `password`
  // and, like it, is split out of the connection body so the plaintext is
  // never folded into the persisted config shape.
  const { password, walletPassword, ...connection } = draft;
  const saved = await invoke<unknown>("save_connection", {
    req: {
      connection: { ...connection, hasPassword: false },
      password,
      wallet_password: walletPassword,
      is_new: isNew,
    },
  });
  return normalizeConnectionConfig(saved);
}

export async function deleteConnection(id: string): Promise<void> {
  return invoke("delete_connection", { id });
}

/**
 * Test a connection. When editing an existing connection the dialog should
 * pass `existingId` so the backend can substitute the stored password if
 * the user left the password input empty.
 */
export async function testConnection(
  draft: ConnectionDraft,
  existingId: string | null = null,
): Promise<string> {
  const { password, walletPassword, ...rest } = draft;
  return invoke<string>("test_connection", {
    req: {
      config: { ...rest, hasPassword: false },
      password,
      wallet_password: walletPassword,
      existing_id: existingId,
    },
  });
}

export async function createSqliteDatabaseFile(path: string): Promise<string> {
  return invoke<string>("create_sqlite_database_file", { path });
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

// --- Import / Export ---

export interface ImportRenamedEntry {
  original_name: string;
  new_name: string;
}

export interface ImportResult {
  imported: string[];
  renamed: ImportRenamedEntry[];
  created_groups: string[];
  skipped_groups: string[];
}

export async function exportConnections(ids: string[]): Promise<string> {
  return invoke<string>("export_connections", { ids });
}

export async function importConnections(json: string): Promise<ImportResult> {
  return invoke<ImportResult>("import_connections", { json });
}

/**
 * Encrypted export. 2026-05-05 — backend는 12-word BIP39 mnemonic을 자동
 * 생성하여 envelope과 함께 단일 응답으로 돌려준다. 사용자 입력 master
 * password는 폐기 — 약한 password가 envelope 강도의 floor가 되는 시나리오
 * 자체를 제거한다. 호출자는 `password`를 화면에 단 한 번 표시하고
 * dialog 닫힐 때 메모리에서 지운다.
 */
export interface EncryptedExportResult {
  password: string;
  json: string;
}

export async function exportConnectionsEncrypted(
  ids: string[],
): Promise<EncryptedExportResult> {
  return invoke<EncryptedExportResult>("export_connections_encrypted", {
    ids,
  });
}

/**
 * Encrypted import. Accepts either an `EncryptedEnvelope` JSON (auto-detected
 * via `kdf` + `ciphertext` fields) or a plain `ExportPayload` JSON. When the
 * payload is an envelope, `masterPassword` is required and a wrong password
 * surfaces the canonical message
 * `Incorrect master password — the file could not be decrypted`. For plain
 * JSON the password is ignored.
 */
export async function importConnectionsEncrypted(
  payload: string,
  masterPassword: string,
): Promise<ImportResult> {
  return invoke<ImportResult>("import_connections_encrypted", {
    payload,
    masterPassword,
  });
}
