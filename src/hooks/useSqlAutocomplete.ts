import { useMemo } from "react";
import { SQLNamespace } from "@codemirror/lang-sql";
import { useSchemaStore } from "../stores/schemaStore";

/**
 * Builds a CodeMirror SQLNamespace from the schema store data for a given connection.
 * Provides table names (schema-qualified) as top-level completions,
 * and column names when completing after a table reference (e.g. `SELECT users.|`).
 */
export function useSqlAutocomplete(connectionId: string): SQLNamespace {
  const tables = useSchemaStore((s) => s.tables);

  return useMemo(() => {
    const ns: SQLNamespace = {};

    // Collect all tables for this connection, grouped by schema
    for (const [key, tableList] of Object.entries(tables)) {
      if (!key.startsWith(`${connectionId}:`)) continue;

      const schemaName = key.slice(connectionId.length + 1);

      for (const table of tableList) {
        // Unqualified table name (e.g. "users")
        if (!ns[table.name]) {
          ns[table.name] = {};
        }
        // Schema-qualified name (e.g. "public.users")
        const qualified = `${schemaName}.${table.name}`;
        if (!ns[qualified]) {
          ns[qualified] = {};
        }
      }
    }

    return ns;
  }, [tables, connectionId]);
}
