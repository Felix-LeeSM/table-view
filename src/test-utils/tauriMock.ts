import { vi, type Mock } from "vitest";
import type * as Tauri from "@lib/tauri";

const TAURI_FUNCTIONS = [
  "addColumnRequest",
  "addConstraint",
  "aggregateDocuments",
  "alterTable",
  "bulkWriteDocuments",
  "cancelQuery",
  "connectToDatabase",
  "countDocuments",
  "countNullRows",
  "createCollection",
  "createIndex",
  "createMongoIndex",
  "createRdbDatabase",
  "createTable",
  "createTablePlan",
  "createTrigger",
  "deleteConnection",
  "deleteDocument",
  "deleteGroup",
  "deleteMany",
  "disconnectFromDatabase",
  "distinctDocuments",
  "dropCollection",
  "dropColumnRequest",
  "dropConstraint",
  "dropIndex",
  "dropMongoDatabase",
  "dropMongoIndex",
  "dropRdbDatabase",
  "dropTable",
  "dropTableRequest",
  "dropTrigger",
  "estimatedDocumentCount",
  "executeQuery",
  "executeQueryBatch",
  "executeQueryDryRun",
  "executeKvCommand",
  "executeSearchQuery",
  "exportConnections",
  "exportConnectionsEncrypted",
  "exportGridRows",
  "exportSchemaDump",
  "findDocuments",
  "findOneDocument",
  "getFunctionSource",
  "getMongoValidator",
  "getTableColumns",
  "getTableConstraints",
  "getTableIndexes",
  "getTriggerSource",
  "getViewColumns",
  "getViewDefinition",
  "importConnections",
  "importConnectionsEncrypted",
  "inferCollectionFields",
  "insertDocument",
  "insertManyDocuments",
  "listConnections",
  "listFunctions",
  "listGroups",
  "listMongoCollections",
  "listMongoDatabases",
  "listMongoIndexes",
  "listPostgresTypes",
  "listSchemaColumns",
  "listSchemas",
  "listTables",
  "listTriggers",
  "listViews",
  "moveConnectionToGroup",
  "openWorkspaceWindow",
  "queryTableData",
  "renameCollection",
  "renameTable",
  "renameTableRequest",
  "runMongoCommand",
  "saveConnection",
  "saveGroup",
  "setMongoValidator",
  "testConnection",
  "updateDocument",
  "updateMany",
  "writeTextFileExport",
] as const;

type TauriModule = typeof Tauri;
type TauriFunctionName = (typeof TAURI_FUNCTIONS)[number] & keyof TauriModule;
type TauriFunction = (...args: never[]) => unknown;

export type TauriMockOverrides = Record<string, TauriFunction | Mock>;

export type TauriMockModule = Record<string, Mock> & {
  [K in TauriFunctionName]: Mock;
};

function unmocked(name: string) {
  return () => {
    throw new Error(`unmocked: ${name}`);
  };
}

export const tauriMock = Object.fromEntries(
  TAURI_FUNCTIONS.map((name) => [name, vi.fn(unmocked(name))]),
) as unknown as TauriMockModule;

const BASE_TAURI_FUNCTIONS = new Set<string>(TAURI_FUNCTIONS);

export function doMockTauriModule(): void {
  vi.doMock("@lib/tauri", () => getTauriMockModule());
  vi.doMock("@/lib/tauri", () => getTauriMockModule());
}

export function doUnmockTauriModule(): void {
  vi.doUnmock("@lib/tauri");
  vi.doUnmock("@/lib/tauri");
}

export function resetTauriMock(): TauriMockModule {
  for (const name of Object.keys(tauriMock)) {
    if (!BASE_TAURI_FUNCTIONS.has(name)) {
      delete tauriMock[name];
    }
  }
  for (const name of TAURI_FUNCTIONS) {
    tauriMock[name].mockReset();
    tauriMock[name].mockImplementation(unmocked(name));
  }
  return tauriMock;
}

export function setupTauriMock(
  overrides: TauriMockOverrides = {},
): TauriMockModule {
  for (const [name, implementation] of Object.entries(overrides) as Array<
    [string, TauriFunction | Mock | undefined]
  >) {
    if (!implementation) continue;
    tauriMock[name] ??= vi.fn(unmocked(name));
    tauriMock[name].mockImplementation((...args: unknown[]) =>
      implementation(...(args as never[])),
    );
  }
  return tauriMock;
}

export function getTauriMockModule(): TauriMockModule {
  return tauriMock;
}
