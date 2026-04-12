import { create } from "zustand";
import type {
  ColumnInfo,
  ConstraintInfo,
  FilterCondition,
  IndexInfo,
  SchemaInfo,
  TableData,
  TableInfo,
} from "../types/schema";
import type { QueryResult } from "../types/query";
import * as tauri from "../lib/tauri";

interface SchemaState {
  schemas: Record<string, SchemaInfo[]>;
  tables: Record<string, TableInfo[]>;
  loading: boolean;
  error: string | null;

  loadSchemas: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, schema: string) => Promise<void>;
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
  loading: false,
  error: null,

  loadSchemas: async (connectionId) => {
    try {
      const schemas = await tauri.listSchemas(connectionId);
      set((state) => ({
        schemas: { ...state.schemas, [connectionId]: schemas },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  loadTables: async (connectionId, schema) => {
    try {
      const tables = await tauri.listTables(connectionId, schema);
      const key = `${connectionId}:${schema}`;
      set((state) => ({
        tables: { ...state.tables, [key]: tables },
      }));
    } catch (e) {
      set({ error: String(e) });
    }
  },

  getTableColumns: async (connectionId, table, schema) => {
    return tauri.getTableColumns(connectionId, table, schema);
  },

  getTableIndexes: async (connectionId, table, schema) => {
    return tauri.getTableIndexes(connectionId, table, schema);
  },

  getTableConstraints: async (connectionId, table, schema) => {
    return tauri.getTableConstraints(connectionId, table, schema);
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
      // Remove all table entries for this connection
      for (const key of Object.keys(newTables)) {
        if (key.startsWith(`${connectionId}:`)) {
          delete newTables[key];
        }
      }
      return { schemas: newSchemas, tables: newTables };
    });
  },
}));
