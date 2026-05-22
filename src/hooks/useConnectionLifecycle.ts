import { useCallback } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useDocumentQueryStore } from "@stores/documentQueryStore";

/**
 * connect 시 schema/document cache를 함께 invalidate. connectionStore action을
 * 컴포넌트가 직접 호출하면 backend가 새로 연 default-DB sub-pool과 이전
 * active DB 기준의 cached schema가 어긋나 재진입 화면이 "초기 DB"로 잘못
 * 노출된다.
 *
 * disconnect/delete teardown은 connectionStore의 state-transition watcher가
 * `cleanupConnectionFrontendState(connectionId)` 한 곳으로 수렴시킨다.
 */
export function useConnectionLifecycle() {
  const storeConnect = useConnectionStore((s) => s.connectToDatabase);
  const storeDisconnect = useConnectionStore((s) => s.disconnectFromDatabase);
  const clearSchema = useSchemaStore((s) => s.clearForConnection);
  const clearDocumentCatalog = useDocumentCatalogStore(
    (s) => s.clearConnection,
  );
  const clearDocumentQuery = useDocumentQueryStore((s) => s.clearConnection);

  const connect = useCallback(
    async (id: string): Promise<boolean> => {
      await storeConnect(id);
      clearSchema(id);
      clearDocumentCatalog(id);
      clearDocumentQuery(id);
      // connectionStore action은 throw 대신 status를 error 변형에 기록하므로
      // 호출자가 await 결과로는 성공 여부를 알 수 없다. hook(외부 layer)에서
      // fresh status를 한 번 읽어 boolean으로 환산해 호출자에게 알린다.
      const status = useConnectionStore.getState().activeStatuses[id];
      return status?.type === "connected";
    },
    [storeConnect, clearSchema, clearDocumentCatalog, clearDocumentQuery],
  );

  const disconnect = useCallback(
    async (id: string) => {
      await storeDisconnect(id);
    },
    [storeDisconnect],
  );

  return { connect, disconnect };
}
