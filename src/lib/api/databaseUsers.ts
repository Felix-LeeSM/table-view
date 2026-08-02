// Issue #1077 Stage 2 — read-only users/roles listing. PG → `pg_roles`
// (password-masked catalog view), MySQL/MariaDB → `mysql.user`, SQL Server →
// `sys.server_principals`. The wire shape carries no secret column: no adapter
// selects `pg_authid`/`pg_shadow`, `authentication_string`/`Password`, or
// `sys.sql_logins.password_hash`. Oracle and every non-RDB paradigm still
// return `Unsupported`.

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
