import { useMemo } from "react";
import { SQLNamespace } from "@codemirror/lang-sql";
import { useSchemaStore } from "../stores/schemaStore";

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
 * Provides table names (schema-qualified) as top-level completions,
 * column names when completing after a table reference (e.g. `SELECT users.|`),
 * and common SQL function names.
 *
 * @param connectionId The active connection identifier.
 * @param tableColumns Optional mapping of table name → column names for column-level completion.
 */
export function useSqlAutocomplete(
  connectionId: string,
  tableColumns?: Record<string, string[]>,
): SQLNamespace {
  const tables = useSchemaStore((s) => s.tables);

  return useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns: Record<string, any> = {};

    // SQL functions — grouped under a virtual "functions" namespace entry
    for (const fn of SQL_FUNCTIONS) {
      ns[fn] = {};
    }

    // Collect all tables for this connection, grouped by schema
    for (const [key, tableList] of Object.entries(tables)) {
      if (!key.startsWith(`${connectionId}:`)) continue;

      const schemaName = key.slice(connectionId.length + 1);

      for (const table of tableList) {
        // Build column namespace for this table if tableColumns provided
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const columnNs: Record<string, any> = {};
        if (tableColumns) {
          const cols = tableColumns[table.name];
          if (cols) {
            for (const col of cols) {
              columnNs[col] = {};
            }
          }
        }

        // Unqualified table name (e.g. "users")
        ns[table.name] = columnNs;

        // Schema-qualified name (e.g. "public.users")
        const qualified = `${schemaName}.${table.name}`;
        ns[qualified] = columnNs;
      }
    }

    return ns as SQLNamespace;
  }, [tables, connectionId, tableColumns]);
}
