import { useCallback } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import * as tauri from "@lib/tauri";

/**
 * The hook owns the Tauri mutation + reload policy: try `tauri.listTables`
 * to pick up the post-mutation server truth, and on listTables throw ask
 * schemaStore to apply the optimistic cache fallback.
 *
 * Invariants: table cache key is `(connectionId, database, schema)`;
 * successful reload records the returned array; fallback only patches the
 * table list and leaves schemas/views/functions/columns untouched.
 */
export function useSchemaTableMutations(): {
  dropTable: (
    connectionId: string,
    database: string,
    table: string,
    schema: string,
  ) => Promise<void>;
  renameTable: (
    connectionId: string,
    database: string,
    table: string,
    schema: string,
    newName: string,
  ) => Promise<void>;
} {
  const recordTablesReloaded = useSchemaStore((s) => s.recordTablesReloaded);
  const recordTableDropped = useSchemaStore((s) => s.recordTableDropped);
  const recordTableRenamed = useSchemaStore((s) => s.recordTableRenamed);

  const dropTable = useCallback(
    async (
      connectionId: string,
      database: string,
      table: string,
      schema: string,
    ): Promise<void> => {
      // Arg order tauri expects: (connId, table, schema, expectedDatabase).
      await tauri.dropTable(connectionId, table, schema, database);
      try {
        // Forward `database` so a swapped backend pool fails closed before
        // populating a wrong-db cache.
        const tables = await tauri.listTables(connectionId, schema, database);
        recordTablesReloaded(connectionId, database, schema, tables);
      } catch {
        // Reload failed — patch the cache optimistically so the UI loses
        // the dropped row even though we couldn't refetch the truth.
        recordTableDropped(connectionId, database, schema, table);
      }
    },
    [recordTableDropped, recordTablesReloaded],
  );

  const renameTable = useCallback(
    async (
      connectionId: string,
      database: string,
      table: string,
      schema: string,
      newName: string,
    ): Promise<void> => {
      // Arg order tauri expects:
      // (connId, table, schema, newName, expectedDatabase).
      await tauri.renameTable(connectionId, table, schema, newName, database);
      try {
        // Forward `database` so a swapped backend pool fails closed before
        // populating a wrong-db cache.
        const tables = await tauri.listTables(connectionId, schema, database);
        recordTablesReloaded(connectionId, database, schema, tables);
      } catch {
        // Reload failed — patch the renamed row in place optimistically.
        recordTableRenamed(connectionId, database, schema, table, newName);
      }
    },
    [recordTableRenamed, recordTablesReloaded],
  );

  return { dropTable, renameTable };
}
