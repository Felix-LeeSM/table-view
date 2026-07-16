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
