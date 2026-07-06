// Issue #1077 Stage 2 — read-only users/roles listing. PG →
// `pg_roles` (password-masked catalog view). The wire shape carries no
// secret column: the backend sources `pg_roles`, never `pg_authid` /
// `pg_shadow`. Other engines return `Unsupported` (PG-first parity lane).

import { invoke } from "@tauri-apps/api/core";

export interface DatabaseUserRow {
  name: string;
  canLogin: boolean;
  isSuperuser: boolean;
  canCreateDb: boolean;
  canCreateRole: boolean;
  replication: boolean;
  connLimit: number;
  validUntil: string | null;
  memberOf: string[];
}

export async function listDatabaseUsers(
  connectionId: string,
): Promise<DatabaseUserRow[]> {
  return invoke<DatabaseUserRow[]>("list_database_users", { connectionId });
}
