import { create } from "zustand";
import type {
  ColumnInfo,
  SchemaInfo,
  TableData,
  TableInfo,
} from "../types/schema";
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
  queryTableData: (
    connectionId: string,
    table: string,
    schema: string,
    page?: number,
    pageSize?: number,
    orderBy?: string,
  ) => Promise<TableData>;
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

  queryTableData: async (
    connectionId,
    table,
    schema,
    page,
    pageSize,
    orderBy,
  ) => {
    return tauri.queryTableData(
      connectionId,
      table,
      schema,
      page,
      pageSize,
      orderBy,
    );
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
