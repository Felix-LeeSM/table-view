import { useEffect, useMemo, useRef, useState } from "react";
import { Network } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { selectSchemaGraphIntelligence } from "@/lib/schemaGraphSelectors";
import { buildSchemaGraphCatalogSnapshot } from "@/lib/schemaGraphSnapshot";
import {
  RUNTIME_RDBMS_DATABASE_TYPES,
  type RuntimeRdbmsDatabaseType,
} from "@/types/rdbmsDataSources";
import SchemaErdRenderer from "./SchemaErdRenderer";

interface SchemaErdPanelProps {
  connectionId: string;
  database: string;
}

const EMPTY_SCHEMAS = Object.freeze([]);
const EMPTY_BY_SCHEMA = Object.freeze({}) as Record<string, never>;

export default function SchemaErdPanel({
  connectionId,
  database,
}: SchemaErdPanelProps) {
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>();
  const metadataInFlightRef = useRef<Set<string>>(new Set());
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
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const prefetchSchemaColumns = useSchemaStore(
    (state) => state.prefetchSchemaColumns,
  );
  const getTableIndexes = useSchemaStore((state) => state.getTableIndexes);
  const getTableConstraints = useSchemaStore(
    (state) => state.getTableConstraints,
  );
  const runtimeDbType = isRuntimeRdbmsDatabaseType(dbType) ? dbType : null;

  useEffect(() => {
    if (!runtimeDbType || schemas.length > 0) return;
    void loadSchemas(connectionId, database);
  }, [connectionId, database, loadSchemas, runtimeDbType, schemas.length]);

  useEffect(() => {
    if (!runtimeDbType) return;
    for (const schema of schemas) {
      const hasTables = Object.prototype.hasOwnProperty.call(
        tablesBySchema,
        schema.name,
      );
      if (!hasTables) {
        void loadTables(connectionId, database, schema.name);
        continue;
      }
      const hasColumns = Object.prototype.hasOwnProperty.call(
        columnsByTable,
        schema.name,
      );
      if (!hasColumns) {
        void prefetchSchemaColumns(connectionId, database, schema.name);
      }
    }
  }, [
    columnsByTable,
    connectionId,
    database,
    loadTables,
    prefetchSchemaColumns,
    runtimeDbType,
    schemas,
    tablesBySchema,
  ]);

  useEffect(() => {
    if (!runtimeDbType) return;

    for (const [schemaName, tables] of Object.entries(tablesBySchema)) {
      for (const table of tables) {
        const tableSchema = table.schema || schemaName;
        const tableName = table.name;

        if (!hasCachedTableEntry(indexesByTable, tableSchema, tableName)) {
          queueTableMetadataFetch(
            metadataInFlightRef.current,
            connectionId,
            database,
            tableSchema,
            tableName,
            "indexes",
            () =>
              getTableIndexes(connectionId, database, tableName, tableSchema),
          );
        }

        if (!hasCachedTableEntry(constraintsByTable, tableSchema, tableName)) {
          queueTableMetadataFetch(
            metadataInFlightRef.current,
            connectionId,
            database,
            tableSchema,
            tableName,
            "constraints",
            () =>
              getTableConstraints(
                connectionId,
                database,
                tableName,
                tableSchema,
              ),
          );
        }
      }
    }
  }, [
    connectionId,
    constraintsByTable,
    database,
    getTableConstraints,
    getTableIndexes,
    indexesByTable,
    runtimeDbType,
    tablesBySchema,
  ]);

  const intelligence = useMemo(() => {
    if (!runtimeDbType) return null;
    const snapshot = buildSchemaGraphCatalogSnapshot({
      dbType: runtimeDbType,
      database,
      schemas,
      tablesBySchema,
      columnsByTable,
      indexesByTable,
      constraintsByTable,
    });
    return selectSchemaGraphIntelligence(snapshot);
  }, [
    columnsByTable,
    constraintsByTable,
    database,
    indexesByTable,
    runtimeDbType,
    schemas,
    tablesBySchema,
  ]);

  if (!runtimeDbType || !intelligence) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground"
      >
        <Network size={28} aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          ERD and dependency view are available for relational runtime adapters
        </p>
        <p className="max-w-md text-xs">
          Non-RDB connections and file analytics aliases do not expose this
          SchemaGraph surface.
        </p>
      </div>
    );
  }

  return (
    <SchemaErdRenderer
      graph={intelligence.graph}
      intelligence={intelligence}
      selectedTableId={selectedTableId}
      onSelectedTableIdChange={setSelectedTableId}
    />
  );
}

function isRuntimeRdbmsDatabaseType(
  dbType: string | undefined,
): dbType is RuntimeRdbmsDatabaseType {
  return RUNTIME_RDBMS_DATABASE_TYPES.includes(
    dbType as RuntimeRdbmsDatabaseType,
  );
}

function hasCachedTableEntry(
  cache: Readonly<Record<string, Readonly<Record<string, readonly unknown[]>>>>,
  schema: string,
  table: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(cache[schema] ?? {}, table);
}

function queueTableMetadataFetch(
  inFlight: Set<string>,
  connectionId: string,
  database: string,
  schema: string,
  table: string,
  kind: "indexes" | "constraints",
  fetchMetadata: () => Promise<unknown>,
): void {
  const key = [connectionId, database, schema, table, kind].join("\u0000");
  if (inFlight.has(key)) return;

  inFlight.add(key);
  void fetchMetadata()
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(key);
    });
}
