import { create } from "zustand";
import type { ColumnInfo } from "@/types/schema";
import type {
  CollectionInfo,
  DatabaseInfo,
  DocumentQueryResult,
  FindBody,
} from "@/types/document";
import * as tauri from "@lib/tauri";

/**
 * Zustand store backing the document paradigm (Sprint 66 P0 read path).
 *
 * Mirrors the `schemaStore` keying convention:
 *   - `databases` is keyed by `connectionId`.
 *   - `collections` and `fieldsCache` are keyed by `${connectionId}:${db}`
 *     and `${connectionId}:${db}:${collection}` respectively.
 *
 * Every async action guards against stale responses by snapshotting a
 * monotonically-increasing request id on entry and dropping the write when
 * the latest id for that key no longer matches. This prevents a slow
 * response from overwriting a fresher one when the user double-clicks or
 * switches collections quickly.
 */
interface DocumentState {
  databases: Record<string, DatabaseInfo[]>;
  collections: Record<string, CollectionInfo[]>;
  fieldsCache: Record<string, ColumnInfo[]>;
  queryResults: Record<string, DocumentQueryResult>;
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
  runFind: (
    connectionId: string,
    database: string,
    collection: string,
    body?: FindBody,
  ) => Promise<DocumentQueryResult>;
  runAggregate: (
    connectionId: string,
    database: string,
    collection: string,
    pipeline: Record<string, unknown>[],
  ) => Promise<DocumentQueryResult>;
  clearConnection: (connectionId: string) => void;
}

// Per-key request counters. Using a module-scoped map (not Zustand state)
// keeps the increment/compare cycle synchronous — critical for the stale
// guard to work without tearing under rapid successive invocations.
const requestCounters = new Map<string, number>();

function nextRequestId(key: string): number {
  const current = requestCounters.get(key) ?? 0;
  const next = current + 1;
  requestCounters.set(key, next);
  return next;
}

function isLatestRequest(key: string, requestId: number): boolean {
  return requestCounters.get(key) === requestId;
}

export const useDocumentStore = create<DocumentState>((set) => ({
  databases: {},
  collections: {},
  fieldsCache: {},
  queryResults: {},
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
    const cacheKey = `${connectionId}:${database}`;
    const key = `collections:${cacheKey}`;
    const reqId = nextRequestId(key);
    set({ loading: true, error: null });
    try {
      const collections = await tauri.listMongoCollections(
        connectionId,
        database,
      );
      if (!isLatestRequest(key, reqId)) return;
      set((state) => ({
        collections: { ...state.collections, [cacheKey]: collections },
        loading: false,
      }));
    } catch (e) {
      if (!isLatestRequest(key, reqId)) return;
      set({ error: String(e), loading: false });
    }
  },

  inferFields: async (connectionId, database, collection, sampleSize) => {
    const cacheKey = `${connectionId}:${database}:${collection}`;
    const key = `fields:${cacheKey}`;
    const reqId = nextRequestId(key);
    const columns = await tauri.inferCollectionFields(
      connectionId,
      database,
      collection,
      sampleSize,
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        fieldsCache: { ...state.fieldsCache, [cacheKey]: columns },
      }));
    }
    return columns;
  },

  runFind: async (connectionId, database, collection, body) => {
    const cacheKey = `${connectionId}:${database}:${collection}`;
    const key = `find:${cacheKey}`;
    const reqId = nextRequestId(key);
    const result = await tauri.findDocuments(
      connectionId,
      database,
      collection,
      body,
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        queryResults: { ...state.queryResults, [cacheKey]: result },
      }));
    }
    return result;
  },

  /**
   * Run an aggregation pipeline. Mirrors `runFind`'s stale-guard pattern so
   * a slow response can never overwrite a newer fast one. The result is
   * stashed under an `agg:`-prefixed cache key so it stays distinct from
   * the `find` result for the same `${connectionId}:${database}:${collection}`
   * tuple — both wire types are `DocumentQueryResult`, and mixing them
   * would let a cached find result leak into an aggregate-mode grid render.
   */
  runAggregate: async (connectionId, database, collection, pipeline) => {
    const cacheKey = `agg:${connectionId}:${database}:${collection}:${JSON.stringify(pipeline)}`;
    const key = `aggregate:${cacheKey}`;
    const reqId = nextRequestId(key);
    const result = await tauri.aggregateDocuments(
      connectionId,
      database,
      collection,
      pipeline,
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        queryResults: { ...state.queryResults, [cacheKey]: result },
      }));
    }
    return result;
  },

  clearConnection: (connectionId) => {
    set((state) => {
      const databases = { ...state.databases };
      delete databases[connectionId];
      const prefix = `${connectionId}:`;
      const aggPrefix = `agg:${connectionId}:`;
      const collections = Object.fromEntries(
        Object.entries(state.collections).filter(
          ([k]) => !k.startsWith(prefix),
        ),
      );
      const fieldsCache = Object.fromEntries(
        Object.entries(state.fieldsCache).filter(
          ([k]) => !k.startsWith(prefix),
        ),
      );
      const queryResults = Object.fromEntries(
        Object.entries(state.queryResults).filter(
          ([k]) => !k.startsWith(prefix) && !k.startsWith(aggPrefix),
        ),
      );
      return { databases, collections, fieldsCache, queryResults };
    });
    // Also reset request counters so the next load starts fresh.
    for (const key of [...requestCounters.keys()]) {
      if (
        key === `databases:${connectionId}` ||
        key.startsWith(`collections:${connectionId}:`) ||
        key.startsWith(`fields:${connectionId}:`) ||
        key.startsWith(`find:${connectionId}:`) ||
        key.startsWith(`aggregate:agg:${connectionId}:`)
      ) {
        requestCounters.delete(key);
      }
    }
  },
}));

/** Test-only hook: reset the store + request counters between unit tests. */
export function __resetDocumentStoreForTests(): void {
  requestCounters.clear();
  useDocumentStore.setState({
    databases: {},
    collections: {},
    fieldsCache: {},
    queryResults: {},
    loading: false,
    error: null,
  });
}
