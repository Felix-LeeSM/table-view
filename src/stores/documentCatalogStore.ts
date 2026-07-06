import { create, type StoreApi, type UseBoundStore } from "zustand";
import type { ColumnInfo, IndexInfo } from "@/types/schema";
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
import { createRequestGuard } from "./requestGuard";

export interface DocumentCatalogState {
  databases: ByConn<DatabaseInfo[]>;
  collections: ByConn<ByDb<CollectionInfo[]>>;
  fieldsCache: ByConn<ByDb<ByCollection<ColumnInfo[]>>>;
  indexesCache: ByConn<ByDb<ByCollection<IndexInfo[]>>>;
  loading: boolean;
  error: string | null;

  loadDatabases: (connectionId: string) => Promise<string | null>;
  loadCollections: (
    connectionId: string,
    database: string,
  ) => Promise<string | null>;
  inferFields: (
    connectionId: string,
    database: string,
    collection: string,
    sampleSize?: number,
  ) => Promise<ColumnInfo[]>;
  loadCollectionIndexes: (
    connectionId: string,
    database: string,
    collection: string,
    options?: { force?: boolean },
  ) => Promise<IndexInfo[]>;
  clearConnection: (connectionId: string) => void;
}

const catalogGuard = createRequestGuard();

function clearCatalogCounters(connectionId: string): void {
  catalogGuard.clear(
    (key) =>
      key === `databases:${connectionId}` ||
      key.startsWith(`collections:${connectionId}:`) ||
      key.startsWith(`fields:${connectionId}:`) ||
      key.startsWith(`indexes:${connectionId}:`),
  );
}

export const useDocumentCatalogStore: UseBoundStore<
  StoreApi<DocumentCatalogState>
> = create<DocumentCatalogState>((set) => ({
  databases: {},
  collections: {},
  fieldsCache: {},
  indexesCache: {},
  loading: false,
  error: null,

  loadDatabases: async (connectionId) => {
    const key = `databases:${connectionId}`;
    const reqId = catalogGuard.next(key);
    set({ loading: true, error: null });
    try {
      const databases = await tauri.listMongoDatabases(connectionId);
      if (!catalogGuard.isCurrent(key, reqId)) return null;
      set((state) => ({
        databases: { ...state.databases, [connectionId]: databases },
        loading: false,
      }));
      return null;
    } catch (e) {
      if (!catalogGuard.isCurrent(key, reqId)) return null;
      const error = String(e);
      set({ error, loading: false });
      return error;
    }
  },

  loadCollections: async (connectionId, database) => {
    const key = `collections:${connectionId}:${database}`;
    const reqId = catalogGuard.next(key);
    set({ loading: true, error: null });
    try {
      const collections = await tauri.listMongoCollections(
        connectionId,
        database,
      );
      if (!catalogGuard.isCurrent(key, reqId)) return null;
      set((state) => ({
        collections: setNested2(
          state.collections,
          connectionId,
          database,
          collections,
        ),
        loading: false,
      }));
      return null;
    } catch (e) {
      if (!catalogGuard.isCurrent(key, reqId)) return null;
      const error = String(e);
      set({ error, loading: false });
      return error;
    }
  },

  inferFields: async (connectionId, database, collection, sampleSize) => {
    const key = `fields:${connectionId}:${database}:${collection}`;
    const reqId = catalogGuard.next(key);
    const columns = await tauri.inferCollectionFields(
      connectionId,
      database,
      collection,
      sampleSize,
    );
    if (catalogGuard.isCurrent(key, reqId)) {
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

  loadCollectionIndexes: async (
    connectionId,
    database,
    collection,
    options,
  ) => {
    const cached =
      useDocumentCatalogStore.getState().indexesCache[connectionId]?.[
        database
      ]?.[collection];
    if (cached && options?.force !== true) {
      return cached;
    }
    const key = `indexes:${connectionId}:${database}:${collection}`;
    const reqId = catalogGuard.next(key);
    const indexes = await tauri.listMongoIndexes(
      connectionId,
      database,
      collection,
    );
    if (catalogGuard.isCurrent(key, reqId)) {
      set((state) => ({
        indexesCache: setNested3(
          state.indexesCache,
          connectionId,
          database,
          collection,
          indexes,
        ),
      }));
    }
    return indexes;
  },

  clearConnection: (connectionId) => {
    set((state) => ({
      databases: withoutConnection(state.databases, connectionId),
      collections: withoutConnection(state.collections, connectionId),
      fieldsCache: withoutConnection(state.fieldsCache, connectionId),
      indexesCache: withoutConnection(state.indexesCache, connectionId),
    }));
    clearCatalogCounters(connectionId);
  },
}));

export function __resetDocumentCatalogStoreForTests(): void {
  catalogGuard.reset();
  useDocumentCatalogStore.setState({
    databases: {},
    collections: {},
    fieldsCache: {},
    indexesCache: {},
    loading: false,
    error: null,
  });
}
