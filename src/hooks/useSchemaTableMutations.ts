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
    table: string,
    schema: string,
  ) => Promise<void>;
  renameTable: (
    connectionId: string,
    table: string,
    schema: string,
    newName: string,
  ) => Promise<void>;
} {
  const storeDrop = useSchemaStore((s) => s.dropTable);
  const storeRename = useSchemaStore((s) => s.renameTable);

  const dropTable = useCallback(
    async (
      connectionId: string,
      table: string,
      schema: string,
    ): Promise<void> => {
      await storeDrop(connectionId, table, schema);
      const key = `${connectionId}:${schema}`;
      try {
        const tables = await tauri.listTables(connectionId, schema);
        useSchemaStore.setState((state) => ({
          tables: { ...state.tables, [key]: tables },
        }));
      } catch {
        // Reload failed — patch the cache optimistically so the UI loses
        // the dropped row even though we couldn't refetch the truth.
        useSchemaStore.setState((state) => {
          const current = state.tables[key] ?? [];
          return {
            tables: {
              ...state.tables,
              [key]: current.filter((t) => t.name !== table),
            },
          };
        });
      }
    },
    [storeDrop],
  );

  const renameTable = useCallback(
    async (
      connectionId: string,
      table: string,
      schema: string,
      newName: string,
    ): Promise<void> => {
      await storeRename(connectionId, table, schema, newName);
      const key = `${connectionId}:${schema}`;
      try {
        const tables = await tauri.listTables(connectionId, schema);
        useSchemaStore.setState((state) => ({
          tables: { ...state.tables, [key]: tables },
        }));
      } catch {
        // Reload failed — patch the renamed row in place optimistically.
        useSchemaStore.setState((state) => {
          const current = state.tables[key] ?? [];
          return {
            tables: {
              ...state.tables,
              [key]: current.map((t) =>
                t.name === table ? { ...t, name: newName } : t,
              ),
            },
          };
        });
      }
    },
    [storeRename],
  );

  return { dropTable, renameTable };
}
