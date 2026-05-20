import { create } from "zustand";
import type { ColumnInfo } from "@/types/schema";
import type {
  CollectionInfo,
  DatabaseInfo,
  DocumentQueryResult,
  FindBody,
} from "@/types/document";
import * as tauri from "@lib/tauri";
import { normalizeDocumentQueryResult } from "@lib/wireCamelCase";

/**
 * Zustand store backing the document paradigm read path.
 *
 * Sprint 265 (ADR 0027 extension) — cache shape lifted from colon-keyed
 * strings to `(connId, db, collection)` nested maps. Mirrors the
 * schemaStore / workspaceStore convention so separator collisions in
 * connection / database names cannot corrupt cache keys and connection
 * cleanup collapses to a single `delete state[connId]`.
 *
 * Aggregate results live in a separate axis from find results — same
 * `(connId, db, collection)` path but the inner map is keyed by the
 * stringified pipeline so two distinct pipelines for the same collection
 * stay distinct, and a find result can never leak into an aggregate-mode
 * grid render or vice versa.
 *
 * Every async action guards against stale responses by snapshotting a
 * monotonically-increasing request id on entry and dropping the write
 * when the latest id for that key no longer matches. Counter keys remain
 * flat strings — they are internal identifiers with no cross-cutting
 * consumer.
 */
type ByCollection<V> = Record<string, V>;
type ByDb<V> = Record<string, V>;
type ByConn<V> = Record<string, V>;

interface DocumentState {
  databases: ByConn<DatabaseInfo[]>;
  collections: ByConn<ByDb<CollectionInfo[]>>;
  fieldsCache: ByConn<ByDb<ByCollection<ColumnInfo[]>>>;
  queryResults: ByConn<ByDb<ByCollection<DocumentQueryResult>>>;
  aggregateResults: ByConn<
    ByDb<ByCollection<Record<string, DocumentQueryResult>>>
  >;
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

// Per-key request counters. Module-scoped map (not Zustand state) keeps
// the increment/compare cycle synchronous — critical for the stale guard
// to work without tearing under rapid successive invocations.
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

// Immutable nested setter helpers. Each clones only the spine — `connId
// → db → ...` — so unrelated branches keep referential equality, which
// keeps Zustand selectors stable.
function setNested2<V>(
  outer: ByConn<ByDb<V>>,
  connId: string,
  db: string,
  value: V,
): ByConn<ByDb<V>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: value,
    },
  };
}

function setNested3<V>(
  outer: ByConn<ByDb<ByCollection<V>>>,
  connId: string,
  db: string,
  col: string,
  value: V,
): ByConn<ByDb<ByCollection<V>>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: {
        ...(outer[connId]?.[db] ?? {}),
        [col]: value,
      },
    },
  };
}

function setNested4<V>(
  outer: ByConn<ByDb<ByCollection<Record<string, V>>>>,
  connId: string,
  db: string,
  col: string,
  innerKey: string,
  value: V,
): ByConn<ByDb<ByCollection<Record<string, V>>>> {
  return {
    ...outer,
    [connId]: {
      ...(outer[connId] ?? {}),
      [db]: {
        ...(outer[connId]?.[db] ?? {}),
        [col]: {
          ...(outer[connId]?.[db]?.[col] ?? {}),
          [innerKey]: value,
        },
      },
    },
  };
}

export const useDocumentStore = create<DocumentState>((set) => ({
  databases: {},
  collections: {},
  fieldsCache: {},
  queryResults: {},
  aggregateResults: {},
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

  runFind: async (connectionId, database, collection, body) => {
    const key = `find:${connectionId}:${database}:${collection}`;
    const reqId = nextRequestId(key);
    const result = normalizeDocumentQueryResult(
      await tauri.findDocuments(connectionId, database, collection, body),
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        queryResults: setNested3(
          state.queryResults,
          connectionId,
          database,
          collection,
          result,
        ),
      }));
    }
    return result;
  },

  /**
   * Run an aggregation pipeline. Mirrors `runFind`'s stale-guard pattern.
   * Result lives in `aggregateResults`, a separate axis from the find
   * cache — both wire types are `DocumentQueryResult`, and mixing them
   * would let a cached find result leak into an aggregate-mode grid
   * render (or vice versa). Within `aggregateResults` the innermost key
   * is the stringified pipeline so two distinct pipelines for the same
   * collection stay distinct.
   */
  runAggregate: async (connectionId, database, collection, pipeline) => {
    const pipelineKey = JSON.stringify(pipeline);
    const key = `aggregate:${connectionId}:${database}:${collection}:${pipelineKey}`;
    const reqId = nextRequestId(key);
    const result = normalizeDocumentQueryResult(
      await tauri.aggregateDocuments(
        connectionId,
        database,
        collection,
        pipeline,
      ),
    );
    if (isLatestRequest(key, reqId)) {
      set((state) => ({
        aggregateResults: setNested4(
          state.aggregateResults,
          connectionId,
          database,
          collection,
          pipelineKey,
          result,
        ),
      }));
    }
    return result;
  },

  clearConnection: (connectionId) => {
    set((state) => {
      const databases = { ...state.databases };
      delete databases[connectionId];
      const collections = { ...state.collections };
      delete collections[connectionId];
      const fieldsCache = { ...state.fieldsCache };
      delete fieldsCache[connectionId];
      const queryResults = { ...state.queryResults };
      delete queryResults[connectionId];
      const aggregateResults = { ...state.aggregateResults };
      delete aggregateResults[connectionId];
      return {
        databases,
        collections,
        fieldsCache,
        queryResults,
        aggregateResults,
      };
    });
    // Also reset request counters so the next load starts fresh. Counter
    // keys are flat strings (internal identifiers) — sweep by prefix.
    for (const key of [...requestCounters.keys()]) {
      if (
        key === `databases:${connectionId}` ||
        key.startsWith(`collections:${connectionId}:`) ||
        key.startsWith(`fields:${connectionId}:`) ||
        key.startsWith(`find:${connectionId}:`) ||
        key.startsWith(`aggregate:${connectionId}:`)
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
    aggregateResults: {},
    loading: false,
    error: null,
  });
}
