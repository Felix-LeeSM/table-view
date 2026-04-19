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
} from "../types/schema";
import type { QueryResult } from "../types/query";
import * as tauri from "../lib/tauri";

interface SchemaState {
  schemas: Record<string, SchemaInfo[]>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  /**
   * Column metadata cache, keyed by `${connectionId}:${schema}:${table}`.
   * Populated on demand by `getTableColumns` so that downstream consumers
   * (e.g. SQL autocomplete) can resolve `table.column` candidates without
   * re-fetching from the backend.
   */
  tableColumnsCache: Record<string, ColumnInfo[]>;
  loading: boolean;
  error: string | null;

  loadSchemas: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, schema: string) => Promise<void>;
  loadViews: (connectionId: string, schema: string) => Promise<void>;
  loadFunctions: (connectionId: string, schema: string) => Promise<void>;
  getTableColumns: (
    connectionId: string,
    table: string,
    schema: string,
  ) => Promise<ColumnInfo[]>;
  getTableIndexes: (
    connectionId: string,
    table: string,
    schema: string,
  ) => Promise<IndexInfo[]>;
  getTableConstraints: (
    connectionId: string,
    table: string,
    schema: string,
  ) => Promise<ConstraintInfo[]>;
  getViewColumns: (
    connectionId: string,
    schema: string,
    viewName: string,
  ) => Promise<ColumnInfo[]>;
  getViewDefinition: (
    connectionId: string,
    schema: string,
    viewName: string,
  ) => Promise<string>;
  queryTableData: (
    connectionId: string,
    table: string,
    schema: string,
    page?: number,
    pageSize?: number,
    orderBy?: string,
    filters?: FilterCondition[],
    rawWhere?: string,
  ) => Promise<TableData>;
  dropTable: (
    connectionId: string,
    table: string,
    schema: string,
  ) => Promise<void>;
  executeQuery: (
    connectionId: string,
    sql: string,
    queryId: string,
  ) => Promise<QueryResult>;
  renameTable: (
    connectionId: string,
    table: string,
    schema: string,
    newName: string,
  ) => Promise<void>;
  clearSchema: (connectionId: string) => void;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  schemas: {},
  tables: {},
  views: {},
  functions: {},
  tableColumnsCache: {},
  loading: false,
  error: null,

  loadSchemas: async (connectionId) => {
    set({ loading: true, error: null });
    try {
      const schemas = await tauri.listSchemas(connectionId);
      set((state) => ({
        schemas: { ...state.schemas, [connectionId]: schemas },
        loading: false,
      }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadTables: async (connectionId, schema) => {
    set({ loading: true, error: null });
    try {
      const tables = await tauri.listTables(connectionId, schema);
      const key = `${connectionId}:${schema}`;
      set((state) => ({
        tables: { ...state.tables, [key]: tables },
        loading: false,
      }));
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  loadViews: async (connectionId, schema) => {
    try {
      const views = await tauri.listViews(connectionId, schema);
      const key = `${connectionId}:${schema}`;
      set((state) => ({
        views: { ...state.views, [key]: views },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadFunctions: async (connectionId, schema) => {
    try {
      const functions = await tauri.listFunctions(connectionId, schema);
      const key = `${connectionId}:${schema}`;
      set((state) => ({
        functions: { ...state.functions, [key]: functions },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  getTableColumns: async (connectionId, table, schema) => {
    const columns = await tauri.getTableColumns(connectionId, table, schema);
    // Cache for SQL autocomplete and other consumers
    const cacheKey = `${connectionId}:${schema}:${table}`;
    set((state) => ({
      tableColumnsCache: {
        ...state.tableColumnsCache,
        [cacheKey]: columns,
      },
    }));
    return columns;
  },

  getTableIndexes: async (connectionId, table, schema) => {
    return tauri.getTableIndexes(connectionId, table, schema);
  },

  getTableConstraints: async (connectionId, table, schema) => {
    return tauri.getTableConstraints(connectionId, table, schema);
  },

  getViewColumns: async (connectionId, schema, viewName) => {
    return tauri.getViewColumns(connectionId, schema, viewName);
  },

  getViewDefinition: async (connectionId, schema, viewName) => {
    return tauri.getViewDefinition(connectionId, schema, viewName);
  },

  queryTableData: async (
    connectionId,
    table,
    schema,
    page,
    pageSize,
    orderBy,
    filters,
    rawWhere,
  ) => {
    return tauri.queryTableData(
      connectionId,
      table,
      schema,
      page,
      pageSize,
      orderBy,
      filters,
      rawWhere,
    );
  },

  dropTable: async (connectionId, table, schema) => {
    await tauri.dropTable(connectionId, table, schema);
    // Refresh the table list for this schema after dropping
    const key = `${connectionId}:${schema}`;
    try {
      const tables = await tauri.listTables(connectionId, schema);
      set((state) => ({
        tables: { ...state.tables, [key]: tables },
      }));
    } catch {
      // If refresh fails, remove the table from cache optimistically
      set((state) => {
        const current = state.tables[key] ?? [];
        return {
          tables: {
            ...state.tables,
            [key]: current.filter((t) => t.name !== table),
          },
        };
      });
    }
  },

  executeQuery: async (connectionId, sql, queryId) => {
    return tauri.executeQuery(connectionId, sql, queryId);
  },

  renameTable: async (connectionId, table, schema, newName) => {
    await tauri.renameTable(connectionId, table, schema, newName);
    // Refresh the table list after renaming
    const key = `${connectionId}:${schema}`;
    try {
      const tables = await tauri.listTables(connectionId, schema);
      set((state) => ({
        tables: { ...state.tables, [key]: tables },
      }));
    } catch {
      // If refresh fails, update the table name optimistically
      set((state) => {
        const current = state.tables[key] ?? [];
        return {
          tables: {
            ...state.tables,
            [key]: current.map((t) =>
              t.name === table ? { ...t, name: newName } : t,
            ),
          },
        };
      });
    }
  },

  clearSchema: (connectionId) => {
    set((state) => {
      const newSchemas = { ...state.schemas };
      delete newSchemas[connectionId];
      const newTables = { ...state.tables };
      const newViews = { ...state.views };
      const newFunctions = { ...state.functions };
      const newColumnsCache = { ...state.tableColumnsCache };
      // Remove all entries for this connection
      for (const key of Object.keys(newTables)) {
        if (key.startsWith(`${connectionId}:`)) {
          delete newTables[key];
        }
      }
      for (const key of Object.keys(newViews)) {
        if (key.startsWith(`${connectionId}:`)) {
          delete newViews[key];
        }
      }
      for (const key of Object.keys(newFunctions)) {
        if (key.startsWith(`${connectionId}:`)) {
          delete newFunctions[key];
        }
      }
      for (const key of Object.keys(newColumnsCache)) {
        if (key.startsWith(`${connectionId}:`)) {
          delete newColumnsCache[key];
        }
      }
      return {
        schemas: newSchemas,
        tables: newTables,
        views: newViews,
        functions: newFunctions,
        tableColumnsCache: newColumnsCache,
      };
    });
  },
}));
