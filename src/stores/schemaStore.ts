import { create } from "zustand";
import type {
  ColumnInfo,
  ConstraintInfo,
  FilterCondition,
  FunctionInfo,
  IndexInfo,
  SchemaInfo,
  TableData,
  TableInfo,
  ViewInfo,
} from "@/types/schema";
import type { QueryResult } from "@/types/query";
import * as tauri from "@lib/tauri";
import { parseDbMismatch } from "@lib/api/dbMismatch";
import { syncMismatchedActiveDb } from "@lib/api/syncMismatchedActiveDb";

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
 *   tableColumnsCache: Record<connId, Record<db, Record<schema, Record<table, ColumnInfo[]>>>>
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

type ByDb<V> = Record<string, V>;
type ByConn<V> = Record<string, ByDb<V>>;
type BySchema<V> = Record<string, V>;
type ByTable<V> = Record<string, V>;

interface SchemaState {
  schemas: ByConn<SchemaInfo[]>;
  tables: ByConn<BySchema<TableInfo[]>>;
  views: ByConn<BySchema<ViewInfo[]>>;
  functions: ByConn<BySchema<FunctionInfo[]>>;
  tableColumnsCache: ByConn<BySchema<ByTable<ColumnInfo[]>>>;
  loading: boolean;
  error: string | null;

  loadSchemas: (connId: string, db: string) => Promise<void>;
  loadTables: (connId: string, db: string, schema: string) => Promise<void>;
  loadViews: (connId: string, db: string, schema: string) => Promise<void>;
  loadFunctions: (connId: string, db: string, schema: string) => Promise<void>;
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
  queryTableData: (
    connId: string,
    db: string,
    table: string,
    schema: string,
    page?: number,
    pageSize?: number,
    orderBy?: string,
    filters?: FilterCondition[],
    rawWhere?: string,
  ) => Promise<TableData>;
  dropTable: (
    connId: string,
    db: string,
    table: string,
    schema: string,
  ) => Promise<void>;
  executeQuery: (
    connId: string,
    sql: string,
    queryId: string,
  ) => Promise<QueryResult>;
  executeQueryBatch: (
    connId: string,
    statements: string[],
    queryId: string,
  ) => Promise<QueryResult[]>;
  renameTable: (
    connId: string,
    db: string,
    table: string,
    schema: string,
    newName: string,
  ) => Promise<void>;

  /**
   * Drop every cached entry keyed under `connId` (all DBs). Used on
   * connection delete / disconnect. Same body as `clearForConnection`
   * — the alias survives for caller intent ("disconnect" vs "DB switch").
   */
  clearSchema: (connId: string) => void;
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

// ---------------------------------------------------------------------------
// Internal helpers — immutable nested-map patching. Each helper returns the
// updated outer map (new reference) so React subscribers re-render only on
// real change.
// ---------------------------------------------------------------------------

function setConnDb<V>(
  outer: ByConn<V>,
  connId: string,
  db: string,
  value: V,
): ByConn<V> {
  return {
    ...outer,
    [connId]: { ...(outer[connId] ?? {}), [db]: value },
  };
}

function setConnDbSchema<V>(
  outer: ByConn<BySchema<V>>,
  connId: string,
  db: string,
  schema: string,
  value: V,
): ByConn<BySchema<V>> {
  const connSlot = outer[connId] ?? {};
  const dbSlot = connSlot[db] ?? {};
  return {
    ...outer,
    [connId]: {
      ...connSlot,
      [db]: { ...dbSlot, [schema]: value },
    },
  };
}

function setConnDbSchemaTable<V>(
  outer: ByConn<BySchema<ByTable<V>>>,
  connId: string,
  db: string,
  schema: string,
  table: string,
  value: V,
): ByConn<BySchema<ByTable<V>>> {
  const connSlot = outer[connId] ?? {};
  const dbSlot = connSlot[db] ?? {};
  const schemaSlot = dbSlot[schema] ?? {};
  return {
    ...outer,
    [connId]: {
      ...connSlot,
      [db]: {
        ...dbSlot,
        [schema]: { ...schemaSlot, [table]: value },
      },
    },
  };
}

function deleteConn<V>(outer: ByConn<V>, connId: string): ByConn<V> {
  if (!(connId in outer)) return outer;
  const next = { ...outer };
  delete next[connId];
  return next;
}

function deleteConnDb<V>(
  outer: ByConn<V>,
  connId: string,
  db: string,
): ByConn<V> {
  const connSlot = outer[connId];
  if (!connSlot || !(db in connSlot)) return outer;
  const nextConn = { ...connSlot };
  delete nextConn[db];
  return { ...outer, [connId]: nextConn };
}

function deleteConnDbSchema<V>(
  outer: ByConn<BySchema<V>>,
  connId: string,
  db: string,
  schema: string,
): ByConn<BySchema<V>> {
  const connSlot = outer[connId];
  if (!connSlot) return outer;
  const dbSlot = connSlot[db];
  if (!dbSlot || !(schema in dbSlot)) return outer;
  const nextDb = { ...dbSlot };
  delete nextDb[schema];
  return {
    ...outer,
    [connId]: { ...connSlot, [db]: nextDb },
  };
}

/**
 * Sprint 271a — schemaStore introspection paths are background / silent.
 * When the backend rejects with `AppError::DbMismatch` (Sprint 266 guard),
 * the helper fires verify + setActiveDb so the next dispatch uses the
 * correct expectedDatabase. The original rejection is then rethrown so the
 * caller's loading/error state book-keeping stays consistent with
 * pre-Sprint-271 behaviour — NO toast (contract §Out-of-Scope: "silent
 * introspection (schemaStore prefetch, autocomplete refresh) uses
 * syncMismatchedActiveDb sync-only, no toast").
 */
function handleDbMismatch(connId: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (parseDbMismatch(message)) {
    void syncMismatchedActiveDb(connId);
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSchemaStore = create<SchemaState>((set) => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
  loading: false,
  error: null,

  loadSchemas: async (connId, db) => {
    set({ loading: true, error: null });
    try {
      const schemas = await tauri.listSchemas(connId, db);
      set((state) => ({
        schemas: setConnDb(state.schemas, connId, db, schemas),
        loading: false,
      }));
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: String(e), loading: false });
    }
  },

  loadTables: async (connId, db, schema) => {
    set({ loading: true, error: null });
    try {
      const tables = await tauri.listTables(connId, schema, db);
      set((state) => ({
        tables: setConnDbSchema(state.tables, connId, db, schema, tables),
        loading: false,
      }));
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: String(e), loading: false });
    }
  },

  loadViews: async (connId, db, schema) => {
    try {
      const views = await tauri.listViews(connId, schema, db);
      set((state) => ({
        views: setConnDbSchema(state.views, connId, db, schema, views),
      }));
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: String(e) });
    }
  },

  loadFunctions: async (connId, db, schema) => {
    try {
      const functions = await tauri.listFunctions(connId, schema, db);
      set((state) => ({
        functions: setConnDbSchema(
          state.functions,
          connId,
          db,
          schema,
          functions,
        ),
      }));
    } catch (e) {
      handleDbMismatch(connId, e);
      set({ error: String(e) });
    }
  },

  getTableColumns: async (connId, db, table, schema) => {
    try {
      const columns = await tauri.getTableColumns(connId, table, schema, db);
      set((state) => ({
        tableColumnsCache: setConnDbSchemaTable(
          state.tableColumnsCache,
          connId,
          db,
          schema,
          table,
          columns,
        ),
      }));
      return columns;
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
      return await tauri.getTableIndexes(connId, table, schema, db);
    } catch (e) {
      handleDbMismatch(connId, e);
      throw e;
    }
  },

  getTableConstraints: async (connId, db, table, schema) => {
    try {
      return await tauri.getTableConstraints(connId, table, schema, db);
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

  queryTableData: async (
    connId,
    db,
    table,
    schema,
    page,
    pageSize,
    orderBy,
    filters,
    rawWhere,
  ) => {
    // Sprint 271b — forward `db` as `expectedDatabase` so the backend
    // guard rejects a swapped pool BEFORE the SELECT runs. DataGrid is
    // the only caller and routes mismatches through its own catch path
    // (user-initiated Retry toast lives there); we deliberately do NOT
    // call `handleDbMismatch` here so the rejection propagates to the
    // caller unchanged.
    return tauri.queryTableData(
      connId,
      table,
      schema,
      page,
      pageSize,
      orderBy,
      filters,
      rawWhere,
      db,
    );
  },

  // Sprint 223 — reload+fallback moved to `useSchemaTableMutations`.
  dropTable: (cid, _db, table, schema) => tauri.dropTable(cid, table, schema),

  executeQuery: async (connId, sql, queryId) => {
    return tauri.executeQuery(connId, sql, queryId);
  },

  executeQueryBatch: async (connId, statements, queryId) => {
    return tauri.executeQueryBatch(connId, statements, queryId);
  },

  // Sprint 223 — see `dropTable` comment.
  renameTable: (cid, _db, t, s, n) => tauri.renameTable(cid, t, s, n),

  clearSchema: (connId) => {
    set((state) => ({
      schemas: deleteConn(state.schemas, connId),
      tables: deleteConn(state.tables, connId),
      views: deleteConn(state.views, connId),
      functions: deleteConn(state.functions, connId),
      tableColumnsCache: deleteConn(state.tableColumnsCache, connId),
    }));
  },

  clearForConnection: (connId) => {
    set((state) => ({
      schemas: deleteConn(state.schemas, connId),
      tables: deleteConn(state.tables, connId),
      views: deleteConn(state.views, connId),
      functions: deleteConn(state.functions, connId),
      tableColumnsCache: deleteConn(state.tableColumnsCache, connId),
    }));
  },

  clearForWorkspace: (connId, db) => {
    set((state) => ({
      schemas: deleteConnDb(state.schemas, connId, db),
      tables: deleteConnDb(state.tables, connId, db),
      views: deleteConnDb(state.views, connId, db),
      functions: deleteConnDb(state.functions, connId, db),
      tableColumnsCache: deleteConnDb(state.tableColumnsCache, connId, db),
    }));
  },

  evictSchemaForName: (connId, db, schemaName) => {
    set((state) => ({
      tables: deleteConnDbSchema(state.tables, connId, db, schemaName),
      views: deleteConnDbSchema(state.views, connId, db, schemaName),
      functions: deleteConnDbSchema(state.functions, connId, db, schemaName),
    }));
  },

  prefetchSchemaColumns: async (connId, db, schema) => {
    try {
      const result = await tauri.listSchemaColumns(connId, schema, db);
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
    } catch (e) {
      // best-effort prefetch — silently ignore failures. Sprint 271a — still
      // surface a DbMismatch via the sync helper so the next dispatch uses
      // the corrected activeDb. No toast (background path).
      handleDbMismatch(connId, e);
    }
  },
}));
