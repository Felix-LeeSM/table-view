import {
  __resetDocumentCatalogStoreForTests,
  useDocumentCatalogStore,
  type DocumentCatalogState,
} from "@stores/documentCatalogStore";
import {
  __resetDocumentQueryStoreForTests,
  useDocumentQueryStore,
  type DocumentQueryState,
} from "@stores/documentQueryStore";

type DocumentStoreTestState = Omit<DocumentCatalogState, "clearConnection"> &
  Omit<DocumentQueryState, "clearConnection"> & {
    clearConnection: (connectionId: string) => void;
  };

function clearConnection(connectionId: string): void {
  useDocumentCatalogStore.getState().clearConnection(connectionId);
  useDocumentQueryStore.getState().clearConnection(connectionId);
}

function getDocumentStoreState(): DocumentStoreTestState {
  return {
    ...useDocumentCatalogStore.getState(),
    ...useDocumentQueryStore.getState(),
    clearConnection,
  };
}

function setDocumentStoreState(partial: Partial<DocumentStoreTestState>): void {
  const catalogPatch: Partial<DocumentCatalogState> = {};
  if ("databases" in partial) catalogPatch.databases = partial.databases;
  if ("collections" in partial) catalogPatch.collections = partial.collections;
  if ("fieldsCache" in partial) catalogPatch.fieldsCache = partial.fieldsCache;
  if ("indexesCache" in partial) {
    catalogPatch.indexesCache = partial.indexesCache;
  }
  if ("loading" in partial) catalogPatch.loading = partial.loading;
  if ("error" in partial) catalogPatch.error = partial.error;
  if (Object.keys(catalogPatch).length > 0) {
    useDocumentCatalogStore.setState(catalogPatch);
  }

  const queryPatch: Partial<DocumentQueryState> = {};
  if ("queryResults" in partial) {
    queryPatch.queryResults = partial.queryResults;
  }
  if ("aggregateResults" in partial) {
    queryPatch.aggregateResults = partial.aggregateResults;
  }
  if (Object.keys(queryPatch).length > 0) {
    useDocumentQueryStore.setState(queryPatch);
  }
}

export const useDocumentStore = {
  getState: getDocumentStoreState,
  setState: setDocumentStoreState,
};

export function __resetDocumentStoreForTests(): void {
  __resetDocumentCatalogStoreForTests();
  __resetDocumentQueryStoreForTests();
}
