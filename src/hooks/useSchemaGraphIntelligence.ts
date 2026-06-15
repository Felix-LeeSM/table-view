import { useMemo } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { selectSchemaGraphIntelligence } from "@/lib/schemaGraphSelectors";
import { buildSchemaGraphCatalogSnapshot } from "@/lib/schemaGraphSnapshot";
import {
  RUNTIME_RDBMS_DATABASE_TYPES,
  type RuntimeRdbmsDatabaseType,
} from "@/types/rdbmsDataSources";

const EMPTY_SCHEMAS = Object.freeze([]);
const EMPTY_BY_SCHEMA = Object.freeze({}) as Record<string, never>;

export function useSchemaGraphIntelligence(
  connectionId: string,
  database: string,
) {
  const dbType = useConnectionStore(
    (state) =>
      state.connections.find((connection) => connection.id === connectionId)
        ?.dbType,
  );
  const schemas = useSchemaStore(
    (state) => state.schemas[connectionId]?.[database] ?? EMPTY_SCHEMAS,
  );
  const tablesBySchema = useSchemaStore(
    (state) => state.tables[connectionId]?.[database] ?? EMPTY_BY_SCHEMA,
  );
  const columnsByTable = useSchemaStore(
    (state) =>
      state.tableColumnsCache[connectionId]?.[database] ?? EMPTY_BY_SCHEMA,
  );
  const indexesByTable = useSchemaStore(
    (state) =>
      state.tableIndexesCache[connectionId]?.[database] ?? EMPTY_BY_SCHEMA,
  );
  const constraintsByTable = useSchemaStore(
    (state) =>
      state.tableConstraintsCache[connectionId]?.[database] ?? EMPTY_BY_SCHEMA,
  );
  const runtimeDbType = isRuntimeRdbmsDatabaseType(dbType) ? dbType : null;

  return useMemo(() => {
    if (!runtimeDbType) return null;
    return selectSchemaGraphIntelligence(
      buildSchemaGraphCatalogSnapshot({
        dbType: runtimeDbType,
        database,
        schemas,
        tablesBySchema,
        columnsByTable,
        indexesByTable,
        constraintsByTable,
      }),
    );
  }, [
    columnsByTable,
    constraintsByTable,
    database,
    indexesByTable,
    runtimeDbType,
    schemas,
    tablesBySchema,
  ]);
}

function isRuntimeRdbmsDatabaseType(
  dbType: string | undefined,
): dbType is RuntimeRdbmsDatabaseType {
  return RUNTIME_RDBMS_DATABASE_TYPES.includes(
    dbType as RuntimeRdbmsDatabaseType,
  );
}
