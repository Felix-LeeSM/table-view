import { create } from "zustand";
import type {
  ColumnInfo,
  ConstraintInfo,
  FunctionInfo,
  IndexInfo,
  PostgresExtensionInfo,
  SchemaInfo,
  SqliteCapabilityInventory,
  TableInfo,
  TriggerInfo,
  ViewInfo,
} from "@/types/schema";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type { DatabaseInfo } from "@/types/document";
import * as tauri from "@lib/tauri";
import { getTauriErrorMessage } from "@lib/tauri/error";
import {
  deleteConn,
  deleteConnDb,
  deleteConnDbSchema,
  deleteConnDbSchemaTable,
  renameConnDbSchemaTable,
  retainConnDbSchemaTables,
  setConnDb,
  setConnDbSchema,
  setConnDbSchemaTable,
  type ByConn,
  type BySchema,
  type ByTable,
} from "./schemaStoreMaps";

/**
 * Sprint 263 (ADR 0027 extension) — schemaStore 의 캐시 차원을
 * `(connId, db)` 별로 분리한다. 같은 connection 의 db1 ↔ db2 toggle 시
 * 캐시가 재사용되어 reload wait 가 사라진다.
 *
 * Cache key shape:
 *   schemas:           Record<connId, Record<db, SchemaInfo[]>>
 *   tables:            Record<connId, Record<db, Record<schema, TableInfo[]>>>
 *   views:             Record<connId, Record<db, Record<schema, ViewInfo[]>>>
 *   functions:         Record<connId, Record<db, Record<schema, FunctionInfo[]>>>
 *   postgresExtensions: Record<connId, Record<db, PostgresExtensionInfo[]>>
 *   sqliteCapabilities: Record<connId, Record<db, SqliteCapabilityInventory>>
 *   tableColumnsCache: Record<connId, Record<db, Record<schema, Record<table, ColumnInfo[]>>>>
 *   tableIndexesCache: Record<connId, Record<db, Record<schema, Record<table, IndexInfo[]>>>>
 *   tableConstraintsCache: Record<connId, Record<db, Record<schema, Record<table, ConstraintInfo[]>>>>
 *
 * Sprint 262 의 workspaceStore `Record<conn, Record<db, ...>>` 패턴과
 * 동일. flat `"conn:db:schema"` 문자열 키 회피 — separator 충돌 없음.
 *
 * Backend tauri command 시그니처는 변경 없음. backend connection pool 의
 * active DB 를 사용하며, 프론트엔드는 fetch 시점의 activeDb 를 캐시 키로
 * 잠는다. activeDb 와 backend pool 의 동기성은 DbSwitcher 의
 * `await switchActiveDb()` → `setActiveDb()` 순서가 보장.
 *
 * Sprint 271a (2026-05-13) — 모든 read-only 호출이 backend 가드에 의해
 * AppError::DbMismatch 로 short-circuit 될 수 있도록 캐시 키로 잠근
 * `db` 를 `expectedDatabase` 로 forwarding. mismatch 가 surface 되면
 * 백그라운드 introspection 이므로 silent sync (no toast) 로 처리.
 */

export type SchemaDbMismatchRecoveryHandler = (
  connId: string,
  err: unknown,
) => void;

let dbMismatchRecoveryHandler: SchemaDbMismatchRecoveryHandler | null = null;

export function registerSchemaDbMismatchRecoveryHandler(
  handler: SchemaDbMismatchRecoveryHandler | null,
): void {
  dbMismatchRecoveryHandler = handler;
}

interface SchemaState {
  databases: Record<string, DatabaseInfo[]>;
  schemas: ByConn<SchemaInfo[]>;
  tables: ByConn<BySchema<TableInfo[]>>;
  views: ByConn<BySchema<ViewInfo[]>>;
  functions: ByConn<BySchema<FunctionInfo[]>>;
  postgresExtensions: ByConn<PostgresExtensionInfo[]>;
  sqliteCapabilities: ByConn<SqliteCapabilityInventory>;
  tableColumnsCache: ByConn<BySchema<ByTable<ColumnInfo[]>>>;
  tableIndexesCache: ByConn<BySchema<ByTable<IndexInfo[]>>>;
  tableConstraintsCache: ByConn<BySchema<ByTable<ConstraintInfo[]>>>;
  fileAnalyticsSources: Record<string, FileAnalyticsSourceMetadata[]>;
  /**
   * Sprint 272 — per-`(connId, db, schema, table)` trigger cache.
   * Populated lazily by `getTableTriggers`. Mirrors the
   * `tableColumnsCache` shape so the same eviction helpers
   * (`deleteConn` / `deleteConnDb` / `deleteConnDbSchema`) apply.
   */
  triggers: ByConn<BySchema<ByTable<TriggerInfo[]>>>;
  loading: boolean;
  error: string | null;

  loadDatabases: (connId: string) => Promise<DatabaseInfo[]>;
  loadSchemas: (connId: string, db: string) => Promise<void>;
  loadTables: (connId: string, db: string, schema: string) => Promise<void>;
  recordTablesReloaded: (
    connId: string,
    db: string,
    schema: string,
    tables: TableInfo[],
  ) => void;
  recordTableDropped: (
    connId: string,
    db: string,
    schema: string,
    table: string,
  ) => void;
  recordTableRenamed: (
    connId: string,
    db: string,
    schema: string,
    table: string,
    newName: string,
  ) => void;
  loadViews: (connId: string, db: string, schema: string) => Promise<void>;
  loadFunctions: (connId: string, db: string, schema: string) => Promise<void>;
  loadPostgresExtensions: (
    connId: string,
    db: string,
  ) => Promise<PostgresExtensionInfo[]>;
  loadSqliteCapabilities: (
    connId: string,
    db: string,
  ) => Promise<SqliteCapabilityInventory>;
  loadFileAnalyticsSources: (
    connId: string,
  ) => Promise<FileAnalyticsSourceMetadata[]>;
  clearFileAnalyticsSources: (connId: string) => Promise<void>;
  getTableColumns: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<ColumnInfo[]>;
  getTableIndexes: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<IndexInfo[]>;
  getTableConstraints: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<ConstraintInfo[]>;
  /**
   * List triggers for `(connId, db, schema, table)`.
   * Cache-first: second call with identical key returns the cached
   * array without invoking the `listTriggers` IPC. On `DbMismatch` the
   * registered runtime recovery handles passive prefetch silently.
   */
  getTableTriggers: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<TriggerInfo[]>;
  /**
   * Sprint 273 — invalidate the cached entry for `(connId, db, schema,
   * table)` and re-fetch via `listTriggers`. Used by
   * `CreateTriggerDialog` after a successful commit so the new trigger
   * appears under the Triggers child group without a tree-wide reload.
   * Throws on IPC error; the dialog's `useDdlPreviewExecution.runCommit`
   * catch wraps it.
   */
  refreshTableTriggers: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<TriggerInfo[]>;
  getViewColumns: (
    connId: string,
    db: string,
    schema: string,
    viewName: string,
  ) => Promise<ColumnInfo[]>;
  getViewDefinition: (
    connId: string,
    db: string,
    schema: string,
    viewName: string,
  ) => Promise<string>;
  /** Drop every cached entry keyed under `connId` across all DBs. */
  clearForConnection: (connId: string) => void;
  /**
   * Sprint 263 — evict a single `(connId, db)` slot. DbSwitcher does NOT
   * call this on a normal DB toggle (caches survive for toggle re-use);
   * this is reserved for paths that need explicit per-db invalidation.
   */
  clearForWorkspace: (connId: string, db: string) => void;
  /**
   * Drop cached `tables` / `views` / `functions` for one
   * `(connId, db, schemaName)` triple. Encapsulates cache-shape
   * knowledge so UI-side `setState` calls don't grow eviction logic.
   */
  evictSchemaForName: (connId: string, db: string, schemaName: string) => void;
  prefetchSchemaColumns: (
    connId: string,
    db: string,
    schema: string,
  ) => Promise<void>;
}

/**
 * Schema introspection paths are background and silent. Runtime recovery owns
 * DbMismatch parsing and cross-store sync so this store does not import a
 * use-case that imports the store back.
 */
function handleDbMismatch(connId: string, err: unknown): void {
  dbMismatchRecoveryHandler?.(connId, err);
}

// ---------------------------------------------------------------------------
// Request-generation guard (issue #1099)
//
// Each introspection fetcher below writes a `(connId, …)`-keyed cache slot
// AFTER an `await`. If the connection is torn down (disconnect / remove /
// post-DDL punch / mismatch recovery → `clearForConnection`) while an IPC is
// still in flight, the late resolve would re-populate the slot that was just
// cleared — and because several fetchers are cache-first, a reconnect then
// short-circuits to that stale list. A per-connection generation counter,
// bumped by `clearForConnection`, lets the shared `writeIfCurrent` wrapper drop
// any write whose generation was superseded across the await. Mirrors
// `documentQueryStore`'s request counter (issue reference).
// ---------------------------------------------------------------------------
const connectionGenerations = new Map<string, number>();

function connectionGeneration(connId: string): number {
  return connectionGenerations.get(connId) ?? 0;
}

function bumpConnectionGeneration(connId: string): void {
  connectionGenerations.set(connId, connectionGeneration(connId) + 1);
}

/**
 * Run an introspection IPC and apply its store write only if the connection's
 * generation is unchanged across the `await`. Returns the fetched value either
 * way so callers keep their existing return contract (cache-first fetchers
 * still hand the fresh list back to the caller that triggered the fetch).
 */
async function writeIfCurrent<T>(
  connId: string,
  fetch: () => Promise<T>,
  commit: (result: T) => void,
): Promise<T> {
  const generation = connectionGeneration(connId);
  const result = await fetch();
  if (connectionGeneration(connId) === generation) commit(result);
  return result;
}

/** Test-only: reset the generation map so counters don't leak across specs. */
export function __resetSchemaGenerationsForTests(): void {
  connectionGenerations.clear();
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: {},
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  postgresExtensions: {},
  sqliteCapabilities: {},
  tableColumnsCache: {},
  tableIndexesCache: {},
  tableConstraintsCache: {},
  fileAnalyticsSources: {},
  triggers: {},
  loading: false,
  error: null,

  loadDatabases: async (connId) => {
    const cached = get().databases[connId];
    if (cached) return cached;
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listDatabases(connId),
        (databases) =>
          set((state) => ({
            databases: {
              ...state.databases,
              [connId]: databases,
            },
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      return [];
    }
  },

  loadSchemas: async (connId, db) => {
    set({ loading: true, error: null });
    try {
      await writeIfCurrent(
        connId,
        () => tauri.listSchemas(connId, db),
        (schemas) =>
          set((state) => ({
            schemas: setConnDb(state.schemas, connId, db, schemas),
          })),
      );
      set({ loading: false });
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e), loading: false });
    }
  },

  loadTables: async (connId, db, schema) => {
    set({ loading: true, error: null });
    try {
      await writeIfCurrent(
        connId,
        () => tauri.listTables(connId, schema, db),
        (tables) =>
          set((state) => ({
            tables: setConnDbSchema(state.tables, connId, db, schema, tables),
          })),
      );
      set({ loading: false });
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e), loading: false });
    }
  },

  recordTablesReloaded: (connId, db, schema, tables) => {
    const tableNames = new Set(tables.map((table) => table.name));
    set((state) => ({
      tables: setConnDbSchema(state.tables, connId, db, schema, tables),
      tableIndexesCache: retainConnDbSchemaTables(
        state.tableIndexesCache,
        connId,
        db,
        schema,
        tableNames,
      ),
      tableConstraintsCache: retainConnDbSchemaTables(
        state.tableConstraintsCache,
        connId,
        db,
        schema,
        tableNames,
      ),
    }));
  },

  recordTableDropped: (connId, db, schema, table) => {
    set((state) => {
      const current = state.tables[connId]?.[db]?.[schema] ?? [];
      return {
        tables: setConnDbSchema(
          state.tables,
          connId,
          db,
          schema,
          current.filter((t) => t.name !== table),
        ),
        tableIndexesCache: deleteConnDbSchemaTable(
          state.tableIndexesCache,
          connId,
          db,
          schema,
          table,
        ),
        tableConstraintsCache: deleteConnDbSchemaTable(
          state.tableConstraintsCache,
          connId,
          db,
          schema,
          table,
        ),
      };
    });
  },

  recordTableRenamed: (connId, db, schema, table, newName) => {
    set((state) => {
      const current = state.tables[connId]?.[db]?.[schema] ?? [];
      return {
        tables: setConnDbSchema(
          state.tables,
          connId,
          db,
          schema,
          current.map((t) => (t.name === table ? { ...t, name: newName } : t)),
        ),
        tableIndexesCache: renameConnDbSchemaTable(
          state.tableIndexesCache,
          connId,
          db,
          schema,
          table,
          newName,
        ),
        tableConstraintsCache: renameConnDbSchemaTable(
          state.tableConstraintsCache,
          connId,
          db,
          schema,
          table,
          newName,
        ),
      };
    });
  },

  loadViews: async (connId, db, schema) => {
    try {
      await writeIfCurrent(
        connId,
        () => tauri.listViews(connId, schema, db),
        (views) =>
          set((state) => ({
            views: setConnDbSchema(state.views, connId, db, schema, views),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e) });
    }
  },

  loadFunctions: async (connId, db, schema) => {
    try {
      await writeIfCurrent(
        connId,
        () => tauri.listFunctions(connId, schema, db),
        (functions) =>
          set((state) => ({
            functions: setConnDbSchema(
              state.functions,
              connId,
              db,
              schema,
              functions,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e) });
    }
  },

  loadPostgresExtensions: async (connId, db) => {
    const cached = get().postgresExtensions[connId]?.[db];
    if (cached) return cached;
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listPostgresExtensions(connId, db),
        (extensions) =>
          set((state) => ({
            postgresExtensions: setConnDb(
              state.postgresExtensions,
              connId,
              db,
              extensions,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e) });
      throw e;
    }
  },

  loadSqliteCapabilities: async (connId, db) => {
    const cached = get().sqliteCapabilities[connId]?.[db];
    if (cached) return cached;
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listSqliteCapabilities(connId, db),
        (capabilities) =>
          set((state) => ({
            sqliteCapabilities: setConnDb(
              state.sqliteCapabilities,
              connId,
              db,
              capabilities,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: getTauriErrorMessage(e) });
      throw e;
    }
  },

  loadFileAnalyticsSources: async (connId) => {
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listFileAnalyticsSourceMetadata(connId),
        (sources) =>
          set((state) => ({
            fileAnalyticsSources: {
              ...state.fileAnalyticsSources,
              [connId]: sources,
            },
          })),
      );
    } catch (e) {
      set({ error: getTauriErrorMessage(e) });
      throw e;
    }
  },

  clearFileAnalyticsSources: async (connId) => {
    await tauri.clearFileAnalyticsSources(connId);
    set((state) => {
      const next = { ...state.fileAnalyticsSources };
      delete next[connId];
      return { fileAnalyticsSources: next };
    });
  },

  getTableColumns: async (connId, db, table, schema) => {
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.getTableColumns(connId, table, schema, db),
        (columns) =>
          set((state) => ({
            tableColumnsCache: setConnDbSchemaTable(
              state.tableColumnsCache,
              connId,
              db,
              schema,
              table,
              columns,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  // Sprint 263 — frontend cache key takes `(connId, db, schema, table)`.
  // Sprint 271a — forwards `db` as `expectedDatabase` so the backend guard
  // rejects a swapped pool BEFORE the trait dispatches.
  getTableIndexes: async (connId, db, table, schema) => {
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.getTableIndexes(connId, table, schema, db),
        (indexes) =>
          set((state) => ({
            tableIndexesCache: setConnDbSchemaTable(
              state.tableIndexesCache,
              connId,
              db,
              schema,
              table,
              indexes,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  getTableConstraints: async (connId, db, table, schema) => {
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.getTableConstraints(connId, table, schema, db),
        (constraints) =>
          set((state) => ({
            tableConstraintsCache: setConnDbSchemaTable(
              state.tableConstraintsCache,
              connId,
              db,
              schema,
              table,
              constraints,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  // Sprint 272 — cache-first triggers fetcher. Mirrors `tableColumnsCache`
  // shape (`(connId, db, schema, table)` → `TriggerInfo[]`). Second call
  // with identical key short-circuits to the cached array without hitting
  // IPC. Mismatch path is silent (passive prefetch — no toast).
  getTableTriggers: async (connId, db, table, schema) => {
    const cached = get().triggers[connId]?.[db]?.[schema]?.[table];
    if (cached) return cached;
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listTriggers(connId, schema, table, db),
        (triggers) =>
          set((state) => ({
            triggers: setConnDbSchemaTable(
              state.triggers,
              connId,
              db,
              schema,
              table,
              triggers,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  // Sprint 273 — bypass-cache refresh used post-CREATE TRIGGER. Same
  // `setConnDbSchemaTable` write as `getTableTriggers` but skips the
  // cache short-circuit so the dialog's commit-success path sees the
  // new trigger. Throws on IPC error.
  refreshTableTriggers: async (connId, db, table, schema) => {
    try {
      return await writeIfCurrent(
        connId,
        () => tauri.listTriggers(connId, schema, table, db),
        (triggers) =>
          set((state) => ({
            triggers: setConnDbSchemaTable(
              state.triggers,
              connId,
              db,
              schema,
              table,
              triggers,
            ),
          })),
      );
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  getViewColumns: async (connId, db, schema, viewName) => {
    try {
      return await tauri.getViewColumns(connId, schema, viewName, db);
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  getViewDefinition: async (connId, db, schema, viewName) => {
    try {
      return await tauri.getViewDefinition(connId, schema, viewName, db);
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  clearForConnection: (connId) => {
    // #1099 — invalidate any introspection IPC already in flight for this
    // connection so its late resolve can't re-pollute the caches we clear here
    // (and a cache-first reconnect can't short-circuit to that stale list).
    bumpConnectionGeneration(connId);
    set((state) => ({
      databases: (() => {
        const next = { ...state.databases };
        delete next[connId];
        return next;
      })(),
      schemas: deleteConn(state.schemas, connId),
      tables: deleteConn(state.tables, connId),
      views: deleteConn(state.views, connId),
      functions: deleteConn(state.functions, connId),
      postgresExtensions: deleteConn(state.postgresExtensions, connId),
      sqliteCapabilities: deleteConn(state.sqliteCapabilities, connId),
      tableColumnsCache: deleteConn(state.tableColumnsCache, connId),
      tableIndexesCache: deleteConn(state.tableIndexesCache, connId),
      tableConstraintsCache: deleteConn(state.tableConstraintsCache, connId),
      triggers: deleteConn(state.triggers, connId),
      fileAnalyticsSources: (() => {
        const next = { ...state.fileAnalyticsSources };
        delete next[connId];
        return next;
      })(),
    }));
  },

  clearForWorkspace: (connId, db) => {
    set((state) => ({
      schemas: deleteConnDb(state.schemas, connId, db),
      tables: deleteConnDb(state.tables, connId, db),
      views: deleteConnDb(state.views, connId, db),
      functions: deleteConnDb(state.functions, connId, db),
      postgresExtensions: deleteConnDb(state.postgresExtensions, connId, db),
      sqliteCapabilities: deleteConnDb(state.sqliteCapabilities, connId, db),
      tableColumnsCache: deleteConnDb(state.tableColumnsCache, connId, db),
      tableIndexesCache: deleteConnDb(state.tableIndexesCache, connId, db),
      tableConstraintsCache: deleteConnDb(
        state.tableConstraintsCache,
        connId,
        db,
      ),
      triggers: deleteConnDb(state.triggers, connId, db),
    }));
  },

  evictSchemaForName: (connId, db, schemaName) => {
    set((state) => ({
      tables: deleteConnDbSchema(state.tables, connId, db, schemaName),
      views: deleteConnDbSchema(state.views, connId, db, schemaName),
      functions: deleteConnDbSchema(state.functions, connId, db, schemaName),
      tableIndexesCache: deleteConnDbSchema(
        state.tableIndexesCache,
        connId,
        db,
        schemaName,
      ),
      tableConstraintsCache: deleteConnDbSchema(
        state.tableConstraintsCache,
        connId,
        db,
        schemaName,
      ),
      triggers: deleteConnDbSchema(state.triggers, connId, db, schemaName),
    }));
  },

  prefetchSchemaColumns: async (connId, db, schema) => {
    try {
      await writeIfCurrent(
        connId,
        () => tauri.listSchemaColumns(connId, schema, db),
        (result) => {
          const tableEntries = Object.entries(result);
          if (tableEntries.length === 0) return;
          set((state) => {
            let next = state.tableColumnsCache;
            for (const [tableName, columns] of tableEntries) {
              next = setConnDbSchemaTable(
                next,
                connId,
                db,
                schema,
                tableName,
                columns,
              );
            }
            return { tableColumnsCache: next };
          });
        },
      );
    } catch (e) {
      // best-effort prefetch — silently ignore failures. Sprint 271a — still
      // surface a DbMismatch via the sync helper so the next dispatch uses
      // the corrected activeDb. No toast (background path).
      handleDbMismatch(connId, e);
    }
  },
}));
