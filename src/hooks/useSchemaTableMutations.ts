import { useCallback } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import * as tauri from "@lib/tauri";

/**
 * Sprint 223 (P10 step 2) — moves the reload-then-fallback orchestration
 * for `dropTable` / `renameTable` out of `schemaStore.ts` action bodies.
 * The store now owns only the cache state shape + a thin Tauri mutation
 * call; this hook owns the policy: try `tauri.listTables` to pick up the
 * post-mutation server truth, and on listTables throw, optimistically
 * patch `state.tables[key]` so the UI doesn't keep showing the dropped /
 * pre-rename row.
 *
 * Behaviour change 0 — for every input the cache result is byte-equivalent
 * to the pre-extraction store path:
 *   - Happy: `state.tables[key] = await tauri.listTables(connectionId, schema)`
 *     (the array reference returned by tauri).
 *   - Drop fallback: `state.tables[key] = (state.tables[key] ?? []).filter(t => t.name !== table)`.
 *   - Rename fallback: `state.tables[key] = (state.tables[key] ?? []).map(t => t.name === table ? { ...t, name: newName } : t)`.
 *   - Cache key naming: `${connectionId}:${schema}` (frozen).
 *   - `views` / `functions` / `tableColumnsCache` / `schemas` untouched.
 *
 * Tauri command call counts and arg orders are also byte-equivalent:
 *   - drop happy: 1× `dropTable` + 1× `listTables`.
 *   - drop fallback (listTables throws): 1× `dropTable` + 1× `listTables` (rejected).
 *   - rename happy: 1× `renameTable` + 1× `listTables`.
 *   - rename fallback: 1× `renameTable` + 1× `listTables` (rejected).
 *   - store throw on the mutation: re-thrown; reload + fallback never run.
 *
 * Pure orchestration — no useEffect / setInterval / setTimeout / subscribe /
 * window event listener.
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
  const dropTable = useCallback(
    async (
      connectionId: string,
      database: string,
      table: string,
      schema: string,
    ): Promise<void> => {
      // Sprint 354 (L2 fix) — schemaStore.dropTable was a thin pass-through
      // (no cache write); calling tauri.dropTable directly cuts the
      // detour. Same arg order tauri expects: (connId, table, schema,
      // expectedDatabase).
      await tauri.dropTable(connectionId, table, schema, database);
      try {
        // Sprint 271a — forward `database` as `expectedDatabase` so a swapped
        // backend pool fails closed before populating a wrong-db cache.
        const tables = await tauri.listTables(connectionId, schema, database);
        useSchemaStore.setState((state) => ({
          tables: setNested3(
            state.tables,
            connectionId,
            database,
            schema,
            tables,
          ),
        }));
      } catch {
        // Reload failed — patch the cache optimistically so the UI loses
        // the dropped row even though we couldn't refetch the truth.
        useSchemaStore.setState((state) => {
          const current =
            state.tables[connectionId]?.[database]?.[schema] ?? [];
          return {
            tables: setNested3(
              state.tables,
              connectionId,
              database,
              schema,
              current.filter((t) => t.name !== table),
            ),
          };
        });
      }
    },
    [],
  );

  const renameTable = useCallback(
    async (
      connectionId: string,
      database: string,
      table: string,
      schema: string,
      newName: string,
    ): Promise<void> => {
      // Sprint 354 (L2 fix) — schemaStore.renameTable was a thin
      // pass-through. tauri.renameTable arg order:
      // (connId, table, schema, newName, expectedDatabase).
      await tauri.renameTable(connectionId, table, schema, newName, database);
      try {
        // Sprint 271a — forward `database` as `expectedDatabase` so a swapped
        // backend pool fails closed before populating a wrong-db cache.
        const tables = await tauri.listTables(connectionId, schema, database);
        useSchemaStore.setState((state) => ({
          tables: setNested3(
            state.tables,
            connectionId,
            database,
            schema,
            tables,
          ),
        }));
      } catch {
        // Reload failed — patch the renamed row in place optimistically.
        useSchemaStore.setState((state) => {
          const current =
            state.tables[connectionId]?.[database]?.[schema] ?? [];
          return {
            tables: setNested3(
              state.tables,
              connectionId,
              database,
              schema,
              current.map((t) =>
                t.name === table ? { ...t, name: newName } : t,
              ),
            ),
          };
        });
      }
    },
    [],
  );

  return { dropTable, renameTable };
}

// Sprint 263 — immutable triple-nested setter that mirrors the schemaStore
// internal `setConnDbSchema`. Kept local so the hook stays a thin
// orchestration layer and the store body remains untouched.
function setNested3<V>(
  outer: Record<string, Record<string, Record<string, V>>>,
  connId: string,
  db: string,
  schema: string,
  value: V,
): Record<string, Record<string, Record<string, V>>> {
  return {
    ...outer,
    [connId]: {
      ...outer[connId],
      [db]: {
        ...outer[connId]?.[db],
        [schema]: value,
      },
    },
  };
}
