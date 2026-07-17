// Issue #1639 preview + #1640 commit — engine gate for the "Import CSV…" table
// entry point. Now that the commit path (single-row INSERTs through
// `execute_query_batch`) ships, the gate reads the `edit.csvRowImport`
// capability (single source of truth) instead of a local Set — a real UI
// consumer, satisfying the #1462/#1464 "capabilities need a consumer" principle.
// PG-first: `build_csv_import_statements` returns `Unsupported` for other
// engines, so surfacing the entry point there would be error-on-click (#1640).
import type { DatabaseType } from "@/types/connection";
import { DATA_SOURCE_PROFILES } from "@/types/dataSource";

export function supportsCsvImport(dbType: string | undefined): boolean {
  if (!dbType) return false;
  // Index with an arbitrary string returns `undefined` for unknown engines
  // (fail-closed — this gates a write surface).
  const profile = (
    DATA_SOURCE_PROFILES as Partial<
      Record<DatabaseType, (typeof DATA_SOURCE_PROFILES)[DatabaseType]>
    >
  )[dbType as DatabaseType];
  return profile?.capabilities.edit.csvRowImport === true;
}
