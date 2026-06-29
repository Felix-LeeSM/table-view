import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Network } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { selectSchemaGraphDiff } from "@/lib/schemaGraphDiff";
import { selectSchemaGraphIntelligence } from "@/lib/schemaGraphSelectors";
import { buildSchemaGraphCatalogSnapshot } from "@/lib/schemaGraphSnapshot";
import {
  RUNTIME_RDBMS_DATABASE_TYPES,
  type RuntimeRdbmsDatabaseType,
} from "@/types/rdbmsDataSources";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";
import SchemaGraphDiffPanel from "./SchemaGraphDiffPanel";
import SchemaErdRenderer from "./SchemaErdRenderer";

interface SchemaErdPanelProps {
  connectionId: string;
  database: string;
}

const EMPTY_SCHEMAS = Object.freeze([]);
const EMPTY_BY_SCHEMA = Object.freeze({}) as Record<string, never>;
const NO_COMPARISON = "__no_schema_graph_comparison__";

interface CachedSchemaGraphSnapshotOption {
  readonly key: string;
  readonly label: string;
  readonly snapshot: SchemaGraphCatalogSnapshot;
}

export default function SchemaErdPanel({
  connectionId,
  database,
}: SchemaErdPanelProps) {
  const { t } = useTranslation("schema");
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>();
  const [comparisonKey, setComparisonKey] = useState(NO_COMPARISON);
  const metadataInFlightRef = useRef<Set<string>>(new Set());
  const connections = useConnectionStore((state) => state.connections);
  const dbType = connections.find(
    (connection) => connection.id === connectionId,
  )?.dbType;
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
  const allSchemas = useSchemaStore((state) => state.schemas);
  const allTables = useSchemaStore((state) => state.tables);
  const allColumnsByTable = useSchemaStore((state) => state.tableColumnsCache);
  const allIndexesByTable = useSchemaStore((state) => state.tableIndexesCache);
  const allConstraintsByTable = useSchemaStore(
    (state) => state.tableConstraintsCache,
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

  const currentSnapshot = useMemo(() => {
    if (!runtimeDbType) return null;
    const connectionLabel = connections.find(
      (connection) => connection.id === connectionId,
    )?.name;
    return buildSchemaGraphCatalogSnapshot({
      dbType: runtimeDbType,
      database,
      connectionId,
      label: connectionLabel,
      schemas,
      tablesBySchema,
      columnsByTable,
      indexesByTable,
      constraintsByTable,
    });
  }, [
    columnsByTable,
    connectionId,
    connections,
    constraintsByTable,
    database,
    indexesByTable,
    runtimeDbType,
    schemas,
    tablesBySchema,
  ]);
  const intelligence = useMemo(
    () =>
      currentSnapshot ? selectSchemaGraphIntelligence(currentSnapshot) : null,
    [currentSnapshot],
  );
  const cachedSnapshotOptions = useMemo(
    () =>
      buildCachedSchemaGraphSnapshotOptions({
        connections,
        currentConnectionId: connectionId,
        currentDatabase: database,
        schemasByConnection: allSchemas,
        tablesByConnection: allTables,
        columnsByConnection: allColumnsByTable,
        indexesByConnection: allIndexesByTable,
        constraintsByConnection: allConstraintsByTable,
      }),
    [
      allColumnsByTable,
      allConstraintsByTable,
      allIndexesByTable,
      allSchemas,
      allTables,
      connectionId,
      connections,
      database,
    ],
  );
  const comparisonOption = cachedSnapshotOptions.find(
    (option) => option.key === comparisonKey,
  );
  const schemaDiff = useMemo(
    () =>
      currentSnapshot && comparisonOption
        ? selectSchemaGraphDiff(comparisonOption.snapshot, currentSnapshot)
        : null,
    [comparisonOption, currentSnapshot],
  );

  useEffect(() => {
    if (
      comparisonKey !== NO_COMPARISON &&
      !cachedSnapshotOptions.some((option) => option.key === comparisonKey)
    ) {
      setComparisonKey(NO_COMPARISON);
    }
  }, [cachedSnapshotOptions, comparisonKey]);

  if (!runtimeDbType || !intelligence) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground"
      >
        <Network size={28} aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          {t("erdNotAvailableTitle")}
        </p>
        <p className="max-w-md text-xs">{t("erdNotAvailableDesc")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {cachedSnapshotOptions.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-1.5">
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">
              {t("schemaDiffHeading")}
            </p>
            <p className="text-3xs text-muted-foreground">
              {t("compareCachedOnly")}
            </p>
          </div>
          <label className="flex min-w-[14rem] max-w-md flex-1 items-center gap-2 text-xs text-muted-foreground sm:flex-none">
            <span className="sr-only">{t("compareCachedAria")}</span>
            <Select value={comparisonKey} onValueChange={setComparisonKey}>
              <SelectTrigger
                aria-label={t("compareCachedAria")}
                size="xs"
                className="min-w-0 flex-1 border-border bg-background text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_COMPARISON}>
                  {t("noComparison")}
                </SelectItem>
                {cachedSnapshotOptions.map((option) => (
                  <SelectItem key={option.key} value={option.key}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>
      ) : null}
      {schemaDiff ? (
        <div className="border-b border-border bg-background px-3 py-2">
          <SchemaGraphDiffPanel diff={schemaDiff} />
        </div>
      ) : null}
      <SchemaErdRenderer
        graph={intelligence.graph}
        intelligence={intelligence}
        selectedTableId={selectedTableId}
        onSelectedTableIdChange={setSelectedTableId}
      />
    </div>
  );
}

function buildCachedSchemaGraphSnapshotOptions({
  connections,
  currentConnectionId,
  currentDatabase,
  schemasByConnection,
  tablesByConnection,
  columnsByConnection,
  indexesByConnection,
  constraintsByConnection,
}: {
  readonly connections: readonly {
    readonly id: string;
    readonly name: string;
    readonly dbType: string;
  }[];
  readonly currentConnectionId: string;
  readonly currentDatabase: string;
  readonly schemasByConnection: ReturnType<
    typeof useSchemaStore.getState
  >["schemas"];
  readonly tablesByConnection: ReturnType<
    typeof useSchemaStore.getState
  >["tables"];
  readonly columnsByConnection: ReturnType<
    typeof useSchemaStore.getState
  >["tableColumnsCache"];
  readonly indexesByConnection: ReturnType<
    typeof useSchemaStore.getState
  >["tableIndexesCache"];
  readonly constraintsByConnection: ReturnType<
    typeof useSchemaStore.getState
  >["tableConstraintsCache"];
}): readonly CachedSchemaGraphSnapshotOption[] {
  return connections
    .flatMap((connection) => {
      if (!isRuntimeRdbmsDatabaseType(connection.dbType)) return [];
      const dbType = connection.dbType;
      const dbSchemas = schemasByConnection[connection.id] ?? {};
      return Object.entries(dbSchemas).flatMap(([db, cachedSchemas]) => {
        if (connection.id === currentConnectionId && db === currentDatabase) {
          return [];
        }
        const tables = tablesByConnection[connection.id]?.[db];
        const columns = columnsByConnection[connection.id]?.[db];
        if (!tables || !columns) return [];
        return [
          {
            key: cachedSnapshotKey(connection.id, db),
            label: `${connection.name} / ${db} (${connection.dbType})`,
            snapshot: buildSchemaGraphCatalogSnapshot({
              dbType,
              database: db,
              connectionId: connection.id,
              label: connection.name,
              schemas: cachedSchemas,
              tablesBySchema: tables,
              columnsByTable: columns,
              indexesByTable: indexesByConnection[connection.id]?.[db] ?? {},
              constraintsByTable:
                constraintsByConnection[connection.id]?.[db] ?? {},
            }),
          },
        ];
      });
    })
    .sort((left, right) => left.label.localeCompare(right.label, "en"));
}

function cachedSnapshotKey(connectionId: string, database: string): string {
  return `${connectionId}\u0000${database}`;
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
