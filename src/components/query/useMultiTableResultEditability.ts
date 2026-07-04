import { useEffect, useMemo } from "react";
import {
  analyzeMultiTableEditability,
  parseSelectInstances,
  type MultiTableEditability,
} from "@lib/sql/queryAnalyzer";
import type { SchemaColumnLookup } from "@lib/sql/multiTableResolver";
import { useSchemaStore } from "@stores/schemaStore";
import type { QueryColumn } from "@/types/query";

interface UseMultiTableResultEditabilityParams {
  /** When true the multi-table path is skipped entirely (document result,
   *  registered file alias, or an already-known read-only boundary). */
  disabled: boolean;
  sql: string | undefined;
  astReady: boolean;
  connectionId: string | undefined;
  database: string | undefined;
  defaultSchema: string;
  resultColumns: QueryColumn[];
}

/**
 * Issue #1299 — multi-table (JOIN) result editability. Extracted from
 * `QueryResultGrid` so the wrapper stays under the file-size budget. Parses the
 * FROM tables, prefetches their PK metadata into `schemaStore`, then runs the
 * resolver-backed per-column analysis. Returns `null` when the multi-table
 * path does not apply (single-table results flow through the single-table gate).
 */
export function useMultiTableResultEditability({
  disabled,
  sql,
  astReady,
  connectionId,
  database,
  defaultSchema,
  resultColumns,
}: UseMultiTableResultEditabilityParams): MultiTableEditability | null {
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);

  const instances = useMemo(() => {
    if (disabled || !sql || !astReady) return null;
    return parseSelectInstances(sql);
  }, [disabled, sql, astReady]);

  // Prefetch PK metadata for every FROM table so the resolver's schema lookup
  // is populated (mirrors the single-table prefetch in `QueryResultGrid`).
  useEffect(() => {
    if (!instances || !connectionId || !database) return;
    for (const inst of instances) {
      const schema = inst.schema ?? defaultSchema;
      const cached =
        tableColumnsCache[connectionId]?.[database]?.[schema]?.[inst.table];
      if (!cached) {
        getTableColumns(connectionId, database, inst.table, schema).catch(
          () => {
            // Missing metadata keeps the affected instance's columns read-only.
          },
        );
      }
    }
  }, [
    instances,
    connectionId,
    database,
    defaultSchema,
    tableColumnsCache,
    getTableColumns,
  ]);

  return useMemo(() => {
    if (disabled || !sql || !astReady || !connectionId || !database) {
      return null;
    }
    const lookup: SchemaColumnLookup = (schema, table) =>
      tableColumnsCache[connectionId]?.[database]?.[schema ?? defaultSchema]?.[
        table
      ] ?? null;
    return analyzeMultiTableEditability(
      sql,
      resultColumns,
      lookup,
      defaultSchema,
    );
  }, [
    disabled,
    sql,
    astReady,
    connectionId,
    database,
    tableColumnsCache,
    defaultSchema,
    resultColumns,
  ]);
}
