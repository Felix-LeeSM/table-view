import { create } from "zustand";
import type { DocumentQueryResult, FindBody } from "@/types/document";
import * as tauri from "@lib/tauri";
import { normalizeDocumentQueryResult } from "@lib/wireCamelCase";
import {
  setNested3,
  setNested4,
  withoutConnection,
  type ByCollection,
  type ByConn,
  type ByDb,
} from "./documentStoreMaps";

export interface DocumentQueryState {
  queryResults: ByConn<ByDb<ByCollection<DocumentQueryResult>>>;
  aggregateResults: ByConn<
    ByDb<ByCollection<Record<string, DocumentQueryResult>>>
  >;

  runFind: (
    connectionId: string,
    database: string,
    collection: string,
    body?: FindBody,
    // Issue #1269 (P1) — optional cancel-token id forwarded to
    // `find_documents` so the grid Cancel button can abort the browse.
    queryId?: string,
  ) => Promise<DocumentQueryResult>;
  runAggregate: (
    connectionId: string,
    database: string,
    collection: string,
    pipeline: Record<string, unknown>[],
  ) => Promise<DocumentQueryResult>;
  clearConnection: (connectionId: string) => void;
}

const queryRequestCounters = new Map<string, number>();

function nextRequestId(key: string): number {
  const current = queryRequestCounters.get(key) ?? 0;
  const next = current + 1;
  queryRequestCounters.set(key, next);
  return next;
}

function isLatestRequest(key: string, requestId: number): boolean {
  return queryRequestCounters.get(key) === requestId;
}

function clearQueryCounters(connectionId: string): void {
  for (const key of [...queryRequestCounters.keys()]) {
    if (
      key.startsWith(`find:${connectionId}:`) ||
      key.startsWith(`aggregate:${connectionId}:`)
    ) {
      queryRequestCounters.delete(key);
    }
  }
}

export const useDocumentQueryStore = create<DocumentQueryState>((set) => ({
  queryResults: {},
  aggregateResults: {},

  runFind: async (connectionId, database, collection, body, queryId) => {
    const key = `find:${connectionId}:${database}:${collection}`;
    const reqId = nextRequestId(key);
    const result = normalizeDocumentQueryResult(
      await tauri.findDocuments(
        connectionId,
        database,
        collection,
        body,
        queryId,
      ),
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
    set((state) => ({
      queryResults: withoutConnection(state.queryResults, connectionId),
      aggregateResults: withoutConnection(state.aggregateResults, connectionId),
    }));
    clearQueryCounters(connectionId);
  },
}));

export function __resetDocumentQueryStoreForTests(): void {
  queryRequestCounters.clear();
  useDocumentQueryStore.setState({
    queryResults: {},
    aggregateResults: {},
  });
}
