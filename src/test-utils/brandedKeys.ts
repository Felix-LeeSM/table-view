import { entryKey } from "@stores/dataGridEditStore";
import type {
  ConnectionId,
  DatabaseName,
  SchemaName,
  TableName,
} from "@/types/branded";

/**
 * Test-fixture entry key builder (issue #1494). Production mints the four
 * brands at their trust boundary (the tab-close purge and the grid
 * pending-state hook); tests legitimately start from plain string literals, so
 * this brands them in ONE place instead of scattering `as` casts across every
 * store test. Runtime output is identical to `entryKey` — brands are erased.
 */
export const makeEntryKey = (
  connectionId: string,
  database: string,
  schema: string,
  table: string,
): string =>
  entryKey(
    connectionId as ConnectionId,
    database as DatabaseName,
    schema as SchemaName,
    table as TableName,
  );

/**
 * Per-axis brand assertions for schema-graph fixtures (issue #1495, Phase 3).
 * Production brands `schema`/`table` at the Rust-catalog → graph boundary
 * (`collectTables` / `sortedTableRefs`); tests legitimately start from plain
 * string literals, so these brand them in ONE place instead of scattering
 * `as SchemaName` / `as TableName` across every graph test. Brands are erased,
 * so the runtime value is the untouched string.
 */
export const schemaName = (value: string): SchemaName => value as SchemaName;
export const tableName = (value: string): TableName => value as TableName;
