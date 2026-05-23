import { useEffect, useMemo, useState } from "react";
import { Network } from "lucide-react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { extractSchemaGraph } from "@/lib/schemaGraph";
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
  const loadSchemas = useSchemaStore((state) => state.loadSchemas);
  const loadTables = useSchemaStore((state) => state.loadTables);
  const prefetchSchemaColumns = useSchemaStore(
    (state) => state.prefetchSchemaColumns,
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

  const graph = useMemo(() => {
    if (!runtimeDbType) return null;
    return extractSchemaGraph(
      buildSchemaGraphCatalogSnapshot({
        dbType: runtimeDbType,
        database,
        schemas,
        tablesBySchema,
        columnsByTable,
      }),
    );
  }, [columnsByTable, database, runtimeDbType, schemas, tablesBySchema]);

  if (!runtimeDbType || !graph) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground"
      >
        <Network size={28} aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          ERD is available for relational runtime adapters
        </p>
      </div>
    );
  }

  return (
    <SchemaErdRenderer
      graph={graph}
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
