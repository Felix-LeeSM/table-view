import { create } from "zustand";
import type { ColumnInfo } from "@/types/schema";
import type { CollectionInfo, DatabaseInfo } from "@/types/document";
import * as tauri from "@lib/tauri";
import {
  setNested2,
  setNested3,
  withoutConnection,
  type ByCollection,
  type ByConn,
  type ByDb,
} from "./documentStoreMaps";

export interface DocumentCatalogState {
  databases: ByConn<DatabaseInfo[]>;
  collections: ByConn<ByDb<CollectionInfo[]>>;
  fieldsCache: ByConn<ByDb<ByCollection<ColumnInfo[]>>>;
  loading: boolean;
  error: string | null;

  loadDatabases: (connectionId: string) => Promise<void>;
  loadCollections: (connectionId: string, database: string) => Promise<void>;
  inferFields: (
    connectionId: string,
    database: string,
    collection: string,
    sampleSize?: number,
  ) => Promise<ColumnInfo[]>;
  clearConnection: (connectionId: string) => void;
}

const catalogRequestCounters = new Map<string, number>();

function nextRequestId(key: string): number {
  const current = catalogRequestCounters.get(key) ?? 0;
  const next = current + 1;
  catalogRequestCounters.set(key, next);
  return next;
}

function isLatestRequest(key: string, requestId: number): boolean {
  return catalogRequestCounters.get(key) === requestId;
}

function clearCatalogCounters(connectionId: string): void {
  for (const key of [...catalogRequestCounters.keys()]) {
    if (
      key === `databases:${connectionId}` ||
      key.startsWith(`collections:${connectionId}:`) ||
      key.startsWith(`fields:${connectionId}:`)
    ) {
      catalogRequestCounters.delete(key);
    }
  }
}

export const useDocumentCatalogStore = create<DocumentCatalogState>((set) => ({
  databases: {},
  collections: {},
  fieldsCache: {},
  loading: false,
  error: null,

  loadDatabases: async (connectionId) => {
    const key = `databases:${connectionId}`;
    const reqId = nextRequestId(key);
    set({ loading: true, error: null });
    try {
      const databases = await tauri.listMongoDatabases(connectionId);
      if (!isLatestRequest(key, reqId)) return;
      set((state) => ({
        databases: { ...state.databases, [connectionId]: databases },
        loading: false,
      }));
    } catch (e) {
      if (!isLatestRequest(key, reqId)) return;
      set({ error: String(e), loading: false });
    }
  },

  loadCollections: async (connectionId, database) => {
    const key = `collections:${connectionId}:${database}`;
    const reqId = nextRequestId(key);
    set({ loading: true, error: null });
    try {
      const collections = await tauri.listMongoCollections(
        connectionId,
        database,
      );
      if (!isLatestRequest(key, reqId)) return;
      set((state) => ({
        collections: setNested2(
          state.collections,
          connectionId,
          database,
          collections,
        ),
        loading: false,
      }));
    } catch (e) {
      if (!isLatestRequest(key, reqId)) return;
      set({ error: String(e), loading: false });
    }
  },

  inferFields: async (connectionId, database, collection, sampleSize) => {
    const key = `fields:${connectionId}:${database}:${collection}`;
    const reqId = nextRequestId(key);
    const columns = await tauri.inferCollectionFields(
      connectionId,
      database,
      collection,
      sampleSize,
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        fieldsCache: setNested3(
          state.fieldsCache,
          connectionId,
          database,
          collection,
          columns,
        ),
      }));
    }
    return columns;
  },

  clearConnection: (connectionId) => {
    set((state) => ({
      databases: withoutConnection(state.databases, connectionId),
      collections: withoutConnection(state.collections, connectionId),
      fieldsCache: withoutConnection(state.fieldsCache, connectionId),
    }));
    clearCatalogCounters(connectionId);
  },
}));

export function __resetDocumentCatalogStoreForTests(): void {
  catalogRequestCounters.clear();
  useDocumentCatalogStore.setState({
    databases: {},
    collections: {},
    fieldsCache: {},
    loading: false,
    error: null,
  });
}
