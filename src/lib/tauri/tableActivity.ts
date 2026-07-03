import { invoke } from "@tauri-apps/api/core";

/**
 * Table-level pin + recent-usage persistence (#1218). Mirrors the
 * `persist_mru` / `list_favorites` IPC pattern: the frontend store holds the
 * canonical list and ships the full list on every mutate; boot hydration
 * reads it back via `list_table_activity`.
 *
 * `schema` is nullable so schemaless RDBMS (MySQL/MariaDB `no-schema`,
 * SQLite/DuckDB `flat`) round-trip cleanly — the backend stores `NULL`/`''`
 * and this wrapper carries `null`.
 */
export interface PersistTableActivityPayload {
  connectionId: string;
  db: string;
  schema: string | null;
  table: string;
  lastUsed: number | null;
  pinnedAt: number | null;
}

/**
 * Persist is scoped to a single `connectionId`: the backend replaces only that
 * connection's rows, so a concurrent workspace window (a different connection)
 * is never clobbered. Callers pass their owning connection and the subset of
 * entries for it.
 */
export async function persistTableActivity(
  connectionId: string,
  entries: PersistTableActivityPayload[],
): Promise<void> {
  await invoke("persist_table_activity", { connectionId, entries });
}

export async function listTableActivity(): Promise<
  PersistTableActivityPayload[]
> {
  const rows = await invoke<PersistTableActivityPayload[]>(
    "list_table_activity",
  );
  return Array.isArray(rows) ? rows : [];
}
