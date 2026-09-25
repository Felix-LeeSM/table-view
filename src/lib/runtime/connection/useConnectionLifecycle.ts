import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useCallback } from "react";

/**
 * Invalidates the schema/document caches together with connect. When a
 * component calls the connectionStore action directly, the default-DB
 * sub-pool the backend just opened and the schema cached for the previous
 * active DB disagree, and the re-entered screen wrongly shows "initial DB".
 *
 * The connectionStore state-transition watcher funnels disconnect/delete
 * teardown into one place, `cleanupConnectionFrontendState(connectionId)`.
 */
export function useConnectionLifecycle() {
  const storeConnect = useConnectionStore((s) => s.connectToDatabase);
  const storeDisconnect = useConnectionStore((s) => s.disconnectFromDatabase);
  const clearConnectionSchemaCache = useSchemaStore(
    (s) => s.clearForConnection,
  );
  const clearDocumentCatalog = useDocumentCatalogStore(
    (s) => s.clearConnection,
  );
  const clearDocumentQuery = useDocumentQueryStore((s) => s.clearConnection);

  const connect = useCallback(
    async (id: string): Promise<boolean> => {
      await storeConnect(id);
      clearConnectionSchemaCache(id);
      clearDocumentCatalog(id);
      clearDocumentQuery(id);
      // The connectionStore action records a failure in the status's error
      // variant instead of throwing, so the caller cannot tell success from
      // the awaited result. The hook (the outer layer) reads the fresh
      // status once and reports it to the caller as a boolean.
      const status = useConnectionStore.getState().activeStatuses[id];
      return status?.type === "connected";
    },
    [
      storeConnect,
      clearConnectionSchemaCache,
      clearDocumentCatalog,
      clearDocumentQuery,
    ],
  );

  const disconnect = useCallback(
    async (id: string) => {
      await storeDisconnect(id);
    },
    [storeDisconnect],
  );

  return { connect, disconnect };
}
