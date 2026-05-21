import type { DatabaseType } from "@/types/connection";
import type {
  ColumnInfo,
  FunctionInfo,
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
} from "./sqlDialectProfile";

type ByDb<V> = Record<string, V>;
type ByConn<V> = Record<string, ByDb<V>>;
type BySchema<V> = Record<string, V>;
type ByTable<V> = Record<string, V>;

export interface SqlCompletionCatalogStoreSnapshot {
  schemas: ByConn<SchemaInfo[]>;
  tables: ByConn<BySchema<TableInfo[]>>;
  views: ByConn<BySchema<ViewInfo[]>>;
  functions: ByConn<BySchema<FunctionInfo[]>>;
  tableColumnsCache: ByConn<BySchema<ByTable<ColumnInfo[]>>>;
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
  name: string;
}

export interface SqlCompletionCatalogObject {
  kind: "table" | "view";
  schema: string;
  name: string;
  qualifiedName: string;
  rowCount: number | null;
}

export interface SqlCompletionCatalogColumn {
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
  schema: string;
  name: string;
  qualifiedName: string;
  arguments: string | null;
  returnType: string | null;
  language: string | null;
  kind: string;
}

export interface SqlCompletionCatalogSnapshot {
  revision: string;
  schemas: readonly SqlCompletionCatalogSchema[];
  objects: readonly SqlCompletionCatalogObject[];
  columns: readonly SqlCompletionCatalogColumn[];
  functions: readonly SqlCompletionCatalogFunction[];
}

export interface SqlCompletionCacheState {
  schemasLoaded: boolean;
  objectsLoaded: boolean;
  tablesLoaded: boolean;
  viewsLoaded: boolean;
  columnsLoaded: boolean;
  functionsLoaded: boolean;
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
  const explicitSchemas = byConnDb.schemas.map((s) => s.name);
  const objects = [
    ...flattenTables(byConnDb.tables),
    ...flattenViews(byConnDb.views),
  ].sort(compareCatalogObject);
  const columns = flattenColumns(byConnDb.tableColumnsCache).sort(
    compareCatalogColumn,
  );
  const functions = flattenFunctions(byConnDb.functions).sort(
    compareCatalogFunction,
  );
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
      schemas,
      objects,
      columns,
      functions,
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
      schemas: schemas.map((name) => ({ name })),
      objects,
      columns,
      functions,
    },
    cacheState: {
      schemasLoaded: byConnDb.schemasLoaded,
      objectsLoaded: byConnDb.tablesLoaded || byConnDb.viewsLoaded,
      tablesLoaded: byConnDb.tablesLoaded,
      viewsLoaded: byConnDb.viewsLoaded,
      columnsLoaded: byConnDb.columnsLoaded,
      functionsLoaded: byConnDb.functionsLoaded,
    },
  };
}

function selectDb(
  snapshot: SqlCompletionCatalogStoreSnapshot,
  connectionId: string,
  database: string,
): {
  schemas: SchemaInfo[];
  tables: BySchema<TableInfo[]>;
  views: BySchema<ViewInfo[]>;
  functions: BySchema<FunctionInfo[]>;
  tableColumnsCache: BySchema<ByTable<ColumnInfo[]>>;
  schemasLoaded: boolean;
  tablesLoaded: boolean;
  viewsLoaded: boolean;
  functionsLoaded: boolean;
  columnsLoaded: boolean;
} {
  const schemas = snapshot.schemas[connectionId]?.[database];
  const tables = snapshot.tables[connectionId]?.[database];
  const views = snapshot.views[connectionId]?.[database];
  const functions = snapshot.functions[connectionId]?.[database];
  const tableColumnsCache =
    snapshot.tableColumnsCache[connectionId]?.[database];

  return {
    schemas: schemas ?? [],
    tables: tables ?? {},
    views: views ?? {},
    functions: functions ?? {},
    tableColumnsCache: tableColumnsCache ?? {},
    schemasLoaded: schemas !== undefined,
    tablesLoaded: tables !== undefined,
    viewsLoaded: views !== undefined,
    functionsLoaded: functions !== undefined,
    columnsLoaded: tableColumnsCache !== undefined,
  };
}

function flattenTables(
  tables: BySchema<TableInfo[]>,
): SqlCompletionCatalogObject[] {
  return Object.entries(tables).flatMap(([schemaName, tableList]) =>
    tableList.map((table) => {
      const schema = table.schema || schemaName;
      return {
        kind: "table" as const,
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
): SqlCompletionCatalogObject[] {
  return Object.entries(views).flatMap(([schemaName, viewList]) =>
    viewList.map((view) => {
      const schema = view.schema || schemaName;
      return {
        kind: "view" as const,
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
): SqlCompletionCatalogColumn[] {
  const columns: SqlCompletionCatalogColumn[] = [];
  for (const [schema, tables] of Object.entries(tableColumnsCache)) {
    for (const [table, columnList] of Object.entries(tables)) {
      const qualifiedTableName = qualify(schema, table);
      for (const column of columnList) {
        columns.push({
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

function flattenFunctions(
  functions: BySchema<FunctionInfo[]>,
): SqlCompletionCatalogFunction[] {
  return Object.entries(functions).flatMap(([schemaName, functionList]) =>
    functionList.map((fn) => {
      const schema = fn.schema || schemaName;
      return {
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

function mergeSchemas(...groups: readonly (readonly string[])[]): string[] {
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
  return schemas[0] ?? null;
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
  schemas: readonly string[],
  objects: readonly SqlCompletionCatalogObject[],
  columns: readonly SqlCompletionCatalogColumn[],
  functions: readonly SqlCompletionCatalogFunction[],
): string {
  const parts = [
    ...schemas.map((schema) => `s:${schema}`),
    ...objects.map(
      (object) => `o:${object.kind}:${object.qualifiedName}:${object.rowCount}`,
    ),
    ...columns.map(
      (column) =>
        `c:${column.qualifiedName}:${column.dataType}:${column.nullable}:` +
        `${column.isPrimaryKey}:${column.isForeignKey}`,
    ),
    ...functions.map(
      (fn) =>
        `f:${fn.kind}:${fn.qualifiedName}:${fn.arguments ?? ""}:` +
        `${fn.returnType ?? ""}:${fn.language ?? ""}`,
    ),
  ];
  return [
    connectionId,
    database,
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
    left.schema.localeCompare(right.schema) ||
    left.name.localeCompare(right.name) ||
    left.kind.localeCompare(right.kind)
  );
}
