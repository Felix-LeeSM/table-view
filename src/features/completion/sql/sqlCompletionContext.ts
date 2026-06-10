import type { DatabaseType } from "@/types/connection";
import type { DatabaseInfo } from "@/types/document";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type {
  ColumnInfo,
  FunctionInfo,
  PostgresExtensionInfo,
  SchemaInfo,
  TableInfo,
  ViewInfo,
} from "@/types/schema";
import {
  SQL_SHELL_PROFILES,
  getSqlDialectProfile,
  getSqlDialectProfileForDatabaseType,
  type SqlDialectFamily,
  type SqlDialectId,
  type SqlShellId,
} from "@lib/sql/sqlDialectProfile";

type ByDb<V> = Record<string, V>;
type ByConn<V> = Record<string, ByDb<V>>;
type BySchema<V> = Record<string, V>;
type ByTable<V> = Record<string, V>;

export interface SqlCompletionCatalogStoreSnapshot {
  databases?: Record<string, DatabaseInfo[]>;
  schemas: ByConn<SchemaInfo[]>;
  tables: ByConn<BySchema<TableInfo[]>>;
  views: ByConn<BySchema<ViewInfo[]>>;
  functions: ByConn<BySchema<FunctionInfo[]>>;
  tableColumnsCache: ByConn<BySchema<ByTable<ColumnInfo[]>>>;
  postgresExtensions?: ByConn<PostgresExtensionInfo[]>;
  fileAnalyticsSources?: Record<string, FileAnalyticsSourceMetadata[]>;
}

export interface BuildSqlCompletionContextInput extends SqlCompletionCatalogStoreSnapshot {
  connectionId: string;
  database: string;
  dbType?: DatabaseType;
  shell?: SqlShellId;
  serverVersion?: string | null;
  defaultSchema?: string | null;
  searchPath?: readonly string[];
  catalogRevision?: string | number;
}

export interface SqlCompletionCatalogSchema {
  database: string;
  name: string;
}

export interface SqlCompletionCatalogDatabase {
  name: string;
}

export interface SqlCompletionCatalogObject {
  kind: "table" | "view";
  database: string;
  schema: string;
  name: string;
  qualifiedName: string;
  rowCount: number | null;
}

export interface SqlCompletionCatalogColumn {
  database: string;
  schema: string;
  table: string;
  name: string;
  qualifiedTableName: string;
  qualifiedName: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
}

export interface SqlCompletionCatalogFunction {
  database: string;
  schema: string;
  name: string;
  qualifiedName: string;
  arguments: string | null;
  returnType: string | null;
  language: string | null;
  kind: string;
}

export interface SqlCompletionCatalogExtension {
  schema: string;
  name: string;
  version: string;
  comment: string | null;
}

export interface SqlCompletionCatalogSnapshot {
  revision: string;
  databases: readonly SqlCompletionCatalogDatabase[];
  schemas: readonly SqlCompletionCatalogSchema[];
  objects: readonly SqlCompletionCatalogObject[];
  columns: readonly SqlCompletionCatalogColumn[];
  functions: readonly SqlCompletionCatalogFunction[];
  extensions: readonly SqlCompletionCatalogExtension[];
}

export interface SqlCompletionCacheState {
  databasesLoaded: boolean;
  schemasLoaded: boolean;
  objectsLoaded: boolean;
  tablesLoaded: boolean;
  viewsLoaded: boolean;
  columnsLoaded: boolean;
  functionsLoaded: boolean;
  extensionsLoaded: boolean;
}

export interface SqlCompletionContext {
  connectionId: string;
  database: string;
  dialect: SqlDialectId;
  family: SqlDialectFamily;
  shell: SqlShellId;
  serverVersion: string | null;
  defaultSchema: string | null;
  searchPath: readonly string[];
  catalog: SqlCompletionCatalogSnapshot;
  cacheState: SqlCompletionCacheState;
}

export function isSqlShellCompatible(
  shell: SqlShellId,
  dialect: SqlDialectId,
): boolean {
  return SQL_SHELL_PROFILES[shell].dialects.includes(dialect);
}

export function resolveSqlShell(
  dialect: SqlDialectId,
  requested: SqlShellId | undefined,
): SqlShellId {
  const profile = getSqlDialectProfile(dialect);
  if (!requested) return profile.defaultShell;
  if (requested === "none") return "none";
  return isSqlShellCompatible(requested, dialect)
    ? requested
    : profile.defaultShell;
}

export function buildSqlCompletionContext(
  input: BuildSqlCompletionContextInput,
): SqlCompletionContext {
  const profile =
    getSqlDialectProfileForDatabaseType(input.dbType) ??
    getSqlDialectProfile("ansi");
  const byConnDb = selectDb(input, input.connectionId, input.database);
  const databases = mergeDatabases(byConnDb.databases.map((db) => db.name));
  const explicitSchemas = byConnDb.schemas.map((s) => s.name);
  const fileAnalyticsSources =
    profile.id === "duckdb"
      ? (input.fileAnalyticsSources?.[input.connectionId] ?? [])
      : [];
  const fileAnalyticsObjects = flattenFileAnalyticsObjects(
    fileAnalyticsSources,
    inferFileAnalyticsSchema(profile.id),
    input.database,
  );
  const fileAnalyticsColumns = flattenFileAnalyticsColumns(
    fileAnalyticsSources,
    inferFileAnalyticsSchema(profile.id),
    input.database,
  );
  const objects = [
    ...flattenTables(byConnDb.tables, input.database),
    ...flattenViews(byConnDb.views, input.database),
    ...fileAnalyticsObjects,
  ].sort(compareCatalogObject);
  const columns = [
    ...flattenColumns(byConnDb.tableColumnsCache, input.database),
    ...fileAnalyticsColumns,
  ].sort(compareCatalogColumn);
  const functions = flattenFunctions(byConnDb.functions, input.database).sort(
    compareCatalogFunction,
  );
  const supportsExtensionInventory = profile.id === "postgresql";
  const extensions = supportsExtensionInventory
    ? flattenExtensions(byConnDb.postgresExtensions).sort(
        compareCatalogExtension,
      )
    : [];
  const schemas = mergeSchemas(
    explicitSchemas,
    Object.keys(byConnDb.tables),
    Object.keys(byConnDb.views),
    Object.keys(byConnDb.tableColumnsCache),
    objects.map((o) => o.schema),
    columns.map((c) => c.schema),
    functions.map((f) => f.schema),
  );
  const revision =
    input.catalogRevision?.toString() ??
    deriveCatalogRevision(
      input.connectionId,
      input.database,
      databases,
      schemas,
      objects,
      columns,
      functions,
      extensions,
    );

  return {
    connectionId: input.connectionId,
    database: input.database,
    dialect: profile.id,
    family: profile.family,
    shell: resolveSqlShell(profile.id, input.shell),
    serverVersion: input.serverVersion ?? null,
    defaultSchema:
      input.defaultSchema ?? inferDefaultSchema(profile.id, schemas),
    searchPath: input.searchPath ?? inferSearchPath(profile.id, schemas),
    catalog: {
      revision,
      databases: databases.map((name) => ({ name })),
      schemas: schemas.map((name) => ({ database: input.database, name })),
      objects,
      columns,
      functions,
      extensions,
    },
    cacheState: {
      databasesLoaded: byConnDb.databasesLoaded,
      schemasLoaded: byConnDb.schemasLoaded,
      objectsLoaded:
        byConnDb.tablesLoaded ||
        byConnDb.viewsLoaded ||
        fileAnalyticsSources.length > 0,
      tablesLoaded: byConnDb.tablesLoaded,
      viewsLoaded: byConnDb.viewsLoaded,
      columnsLoaded: byConnDb.columnsLoaded || fileAnalyticsColumns.length > 0,
      functionsLoaded: byConnDb.functionsLoaded,
      extensionsLoaded: supportsExtensionInventory && byConnDb.extensionsLoaded,
    },
  };
}

function selectDb(
  snapshot: SqlCompletionCatalogStoreSnapshot,
  connectionId: string,
  database: string,
): {
  databases: DatabaseInfo[];
  schemas: SchemaInfo[];
  tables: BySchema<TableInfo[]>;
  views: BySchema<ViewInfo[]>;
  functions: BySchema<FunctionInfo[]>;
  tableColumnsCache: BySchema<ByTable<ColumnInfo[]>>;
  postgresExtensions: PostgresExtensionInfo[];
  databasesLoaded: boolean;
  schemasLoaded: boolean;
  tablesLoaded: boolean;
  viewsLoaded: boolean;
  functionsLoaded: boolean;
  columnsLoaded: boolean;
  extensionsLoaded: boolean;
} {
  const databases = snapshot.databases?.[connectionId];
  const schemas = snapshot.schemas[connectionId]?.[database];
  const tables = snapshot.tables[connectionId]?.[database];
  const views = snapshot.views[connectionId]?.[database];
  const functions = snapshot.functions[connectionId]?.[database];
  const tableColumnsCache =
    snapshot.tableColumnsCache[connectionId]?.[database];
  const postgresExtensions =
    snapshot.postgresExtensions?.[connectionId]?.[database];

  return {
    databases: databases ?? [],
    schemas: schemas ?? [],
    tables: tables ?? {},
    views: views ?? {},
    functions: functions ?? {},
    tableColumnsCache: tableColumnsCache ?? {},
    postgresExtensions: postgresExtensions ?? [],
    databasesLoaded: databases !== undefined,
    schemasLoaded: schemas !== undefined,
    tablesLoaded: tables !== undefined,
    viewsLoaded: views !== undefined,
    functionsLoaded: functions !== undefined,
    columnsLoaded: tableColumnsCache !== undefined,
    extensionsLoaded: postgresExtensions !== undefined,
  };
}

function flattenTables(
  tables: BySchema<TableInfo[]>,
  database: string,
): SqlCompletionCatalogObject[] {
  return Object.entries(tables).flatMap(([schemaName, tableList]) =>
    tableList.map((table) => {
      const schema = table.schema || schemaName;
      return {
        kind: "table" as const,
        database,
        schema,
        name: table.name,
        qualifiedName: qualify(schema, table.name),
        rowCount: table.row_count,
      };
    }),
  );
}

function flattenViews(
  views: BySchema<ViewInfo[]>,
  database: string,
): SqlCompletionCatalogObject[] {
  return Object.entries(views).flatMap(([schemaName, viewList]) =>
    viewList.map((view) => {
      const schema = view.schema || schemaName;
      return {
        kind: "view" as const,
        database,
        schema,
        name: view.name,
        qualifiedName: qualify(schema, view.name),
        rowCount: null,
      };
    }),
  );
}

function flattenColumns(
  tableColumnsCache: BySchema<ByTable<ColumnInfo[]>>,
  database: string,
): SqlCompletionCatalogColumn[] {
  const columns: SqlCompletionCatalogColumn[] = [];
  for (const [schema, tables] of Object.entries(tableColumnsCache)) {
    for (const [table, columnList] of Object.entries(tables)) {
      const qualifiedTableName = qualify(schema, table);
      for (const column of columnList) {
        columns.push({
          database,
          schema,
          table,
          name: column.name,
          qualifiedTableName,
          qualifiedName: `${qualifiedTableName}.${column.name}`,
          dataType: column.data_type,
          nullable: column.nullable,
          isPrimaryKey: column.is_primary_key,
          isForeignKey: column.is_foreign_key,
        });
      }
    }
  }
  return columns;
}

function flattenFileAnalyticsObjects(
  sources: readonly FileAnalyticsSourceMetadata[],
  schema: string | null,
  database: string,
): SqlCompletionCatalogObject[] {
  if (!schema) return [];
  return sources.map((metadata) => ({
    kind: "table",
    database,
    schema,
    name: metadata.source.alias,
    qualifiedName: qualify(schema, metadata.source.alias),
    rowCount: null,
  }));
}

function flattenFileAnalyticsColumns(
  sources: readonly FileAnalyticsSourceMetadata[],
  schema: string | null,
  database: string,
): SqlCompletionCatalogColumn[] {
  if (!schema) return [];
  return sources.flatMap((metadata) => {
    const qualifiedTableName = qualify(schema, metadata.source.alias);
    return metadata.columns.map((column) => ({
      database,
      schema,
      table: metadata.source.alias,
      name: column.name,
      qualifiedTableName,
      qualifiedName: `${qualifiedTableName}.${column.name}`,
      dataType: column.dataType,
      nullable: true,
      isPrimaryKey: false,
      isForeignKey: false,
    }));
  });
}

function flattenFunctions(
  functions: BySchema<FunctionInfo[]>,
  database: string,
): SqlCompletionCatalogFunction[] {
  return Object.entries(functions).flatMap(([schemaName, functionList]) =>
    functionList.map((fn) => {
      const schema = fn.schema || schemaName;
      return {
        database,
        schema,
        name: fn.name,
        qualifiedName: qualify(schema, fn.name),
        arguments: fn.arguments,
        returnType: fn.returnType,
        language: fn.language,
        kind: fn.kind,
      };
    }),
  );
}

function flattenExtensions(
  extensions: readonly PostgresExtensionInfo[],
): SqlCompletionCatalogExtension[] {
  return extensions.map((extension) => ({
    schema: extension.schema,
    name: extension.name,
    version: extension.version,
    comment: extension.comment,
  }));
}

function mergeSchemas(...groups: readonly (readonly string[])[]): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    for (const name of group) {
      if (name) names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function mergeDatabases(...groups: readonly (readonly string[])[]): string[] {
  const names = new Set<string>();
  for (const group of groups) {
    for (const name of group) {
      if (name) names.add(name);
    }
  }
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

function inferDefaultSchema(
  dialect: SqlDialectId,
  schemas: readonly string[],
): string | null {
  if (dialect === "postgresql" && schemas.includes("public")) return "public";
  if (dialect === "sqlite" && schemas.includes("main")) return "main";
  if (dialect === "duckdb" && schemas.includes("main")) return "main";
  return schemas[0] ?? null;
}

function inferFileAnalyticsSchema(dialect: SqlDialectId): string | null {
  return dialect === "duckdb" ? "main" : null;
}

function inferSearchPath(
  dialect: SqlDialectId,
  schemas: readonly string[],
): readonly string[] {
  const defaultSchema = inferDefaultSchema(dialect, schemas);
  if (!defaultSchema) return [];
  return [
    defaultSchema,
    ...schemas.filter((schema) => schema !== defaultSchema),
  ];
}

function deriveCatalogRevision(
  connectionId: string,
  database: string,
  databases: readonly string[],
  schemas: readonly string[],
  objects: readonly SqlCompletionCatalogObject[],
  columns: readonly SqlCompletionCatalogColumn[],
  functions: readonly SqlCompletionCatalogFunction[],
  extensions: readonly SqlCompletionCatalogExtension[],
): string {
  const parts = [
    ...databases.map((db) => `d:${db}`),
    ...schemas.map((schema) => `s:${schema}`),
    ...objects.map(
      (object) =>
        `o:${object.kind}:${object.database}:${object.qualifiedName}:${object.rowCount}`,
    ),
    ...columns.map(
      (column) =>
        `c:${column.database}:${column.qualifiedName}:${column.dataType}:${column.nullable}:` +
        `${column.isPrimaryKey}:${column.isForeignKey}`,
    ),
    ...functions.map(
      (fn) =>
        `f:${fn.kind}:${fn.database}:${fn.qualifiedName}:${fn.arguments ?? ""}:` +
        `${fn.returnType ?? ""}:${fn.language ?? ""}`,
    ),
    ...extensions.map(
      (extension) =>
        `x:${extension.schema}:${extension.name}:${extension.version}:` +
        `${extension.comment ?? ""}`,
    ),
  ];
  return [
    connectionId,
    database,
    databases.length,
    schemas.length,
    objects.length,
    columns.length,
    functions.length,
    fnv1a(parts),
  ].join(":");
}

function fnv1a(parts: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 1) {
      hash = Math.imul(hash ^ part.charCodeAt(i), 0x01000193);
    }
    hash = Math.imul(hash ^ 0, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function qualify(schema: string, name: string): string {
  return schema ? `${schema}.${name}` : name;
}

function compareCatalogObject(
  left: SqlCompletionCatalogObject,
  right: SqlCompletionCatalogObject,
): number {
  return (
    left.database.localeCompare(right.database) ||
    left.schema.localeCompare(right.schema) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareCatalogColumn(
  left: SqlCompletionCatalogColumn,
  right: SqlCompletionCatalogColumn,
): number {
  return (
    left.database.localeCompare(right.database) ||
    left.schema.localeCompare(right.schema) ||
    left.table.localeCompare(right.table) ||
    left.name.localeCompare(right.name)
  );
}

function compareCatalogFunction(
  left: SqlCompletionCatalogFunction,
  right: SqlCompletionCatalogFunction,
): number {
  return (
    left.database.localeCompare(right.database) ||
    left.schema.localeCompare(right.schema) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareCatalogExtension(
  left: SqlCompletionCatalogExtension,
  right: SqlCompletionCatalogExtension,
): number {
  return (
    left.name.localeCompare(right.name) ||
    left.schema.localeCompare(right.schema) ||
    left.version.localeCompare(right.version)
  );
}
