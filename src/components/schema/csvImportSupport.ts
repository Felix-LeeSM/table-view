// Issue #1639 Stage 1 — engine gate for the "Import CSV…" table entry point.
// Mirrors `supportsMigrationExport` (useMigrationExport.ts): a frontend Set so
// the menu only surfaces where the (future) commit path is implemented.
// PG-first — the row INSERT commit path (#1640) starts on PostgreSQL; other
// engines are added as their commit adapters land. Surfacing the entry point on
// an unsupported engine would be an error-on-click once commit ships (#1048).
const CSV_IMPORT_DBTYPES = new Set(["postgresql"]);

export function supportsCsvImport(dbType: string | undefined): boolean {
  return dbType !== undefined && CSV_IMPORT_DBTYPES.has(dbType);
}
