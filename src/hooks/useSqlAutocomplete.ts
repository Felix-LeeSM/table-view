import { useMemo } from "react";
import { SQLNamespace } from "@codemirror/lang-sql";
import { useSchemaStore } from "@stores/schemaStore";

/** Common SQL functions exposed as autocomplete candidates. */
const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "CAST",
  "CONCAT",
  "LENGTH",
  "UPPER",
  "LOWER",
  "TRIM",
  "SUBSTRING",
  "EXTRACT",
  "DATE_TRUNC",
  "NOW",
  "CURRENT_TIMESTAMP",
];

/**
 * Builds a CodeMirror SQLNamespace from the schema store data for a given connection.
 *
 * Top-level entries:
 * - SQL function names (uppercase) → empty namespace
 * - Unqualified table/view names (e.g. `users`) → column namespace
 * - Schema-qualified names (e.g. `public.users`) → column namespace
 *
 * Column candidates are sourced from `schemaStore.tableColumnsCache`, which is
 * populated whenever a Structure tab or DataGrid loads its columns. An optional
 * `tableColumns` override is still accepted for tests or callers that wish to
 * inject explicit values.
 *
 * @param connectionId The active connection identifier.
 * @param tableColumns Optional explicit mapping of table name → column names.
 *                     When omitted, columns are read from the store cache.
 */
export function useSqlAutocomplete(
  connectionId: string,
  tableColumns?: Record<string, string[]>,
): SQLNamespace {
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const columnsCache = useSchemaStore((s) => s.tableColumnsCache);

  return useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns: Record<string, any> = {};

    // SQL functions — grouped under a virtual "functions" namespace entry
    for (const fn of SQL_FUNCTIONS) {
      ns[fn] = {};
    }

    // Build a lookup of cached columns for *this* connection, indexed by
    // both unqualified table name and schema-qualified name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cachedColumnsByName: Record<string, Record<string, any>> = {};
    const prefix = `${connectionId}:`;
    for (const [key, columns] of Object.entries(columnsCache)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length); // "schema:table"
      const sepIdx = rest.indexOf(":");
      if (sepIdx === -1) continue;
      const schemaName = rest.slice(0, sepIdx);
      const tableName = rest.slice(sepIdx + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const colNs: Record<string, any> = {};
      for (const c of columns) colNs[c.name] = {};
      cachedColumnsByName[tableName] = colNs;
      cachedColumnsByName[`${schemaName}.${tableName}`] = colNs;
    }

    // Helper: pick columns for a given object name. Explicit `tableColumns`
    // override beats the cache so tests can stub deterministically.
    const pickColumns = (
      objectName: string,
      qualifiedName: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Record<string, any> => {
      if (tableColumns && tableColumns[objectName]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colNs: Record<string, any> = {};
        for (const c of tableColumns[objectName]!) colNs[c] = {};
        return colNs;
      }
      return (
        cachedColumnsByName[qualifiedName] ??
        cachedColumnsByName[objectName] ??
        {}
      );
    };

    // Tables
    for (const [key, tableList] of Object.entries(tables)) {
      if (!key.startsWith(`${connectionId}:`)) continue;
      const schemaName = key.slice(connectionId.length + 1);
      for (const table of tableList) {
        const qualified = `${schemaName}.${table.name}`;
        const colNs = pickColumns(table.name, qualified);
        ns[table.name] = colNs;
        ns[qualified] = colNs;
      }
    }

    // Views — exposed identically so `SELECT * FROM active_users` autocompletes
    for (const [key, viewList] of Object.entries(views)) {
      if (!key.startsWith(`${connectionId}:`)) continue;
      const schemaName = key.slice(connectionId.length + 1);
      for (const v of viewList) {
        const qualified = `${schemaName}.${v.name}`;
        const colNs = pickColumns(v.name, qualified);
        // Don't overwrite a table of the same name (rare but possible)
        if (!ns[v.name]) ns[v.name] = colNs;
        if (!ns[qualified]) ns[qualified] = colNs;
      }
    }

    return ns as SQLNamespace;
  }, [tables, views, columnsCache, connectionId, tableColumns]);
}
