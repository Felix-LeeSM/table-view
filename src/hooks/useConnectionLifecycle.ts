import { useCallback } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useDocumentStore } from "@stores/documentStore";

/**
 * connect/disconnect 시 schema/document cache를 함께 invalidate. connectionStore
 * action을 컴포넌트가 직접 호출하면 backend가 새로 연 default-DB sub-pool과
 * 이전 active DB 기준의 cached schema가 어긋나 재진입 화면이 "초기 DB"로
 * 잘못 노출된다. cross-store 호출은 React layer로 모아 store 간 직접
 * 의존(`useXStore.getState()`)을 만들지 않는다.
 */
export function useConnectionLifecycle() {
  const storeConnect = useConnectionStore((s) => s.connectToDatabase);
  const storeDisconnect = useConnectionStore((s) => s.disconnectFromDatabase);
  const clearSchema = useSchemaStore((s) => s.clearForConnection);
  const clearDocument = useDocumentStore((s) => s.clearConnection);

  const connect = useCallback(
    async (id: string) => {
      await storeConnect(id);
      clearSchema(id);
      clearDocument(id);
    },
    [storeConnect, clearSchema, clearDocument],
  );

  const disconnect = useCallback(
    async (id: string) => {
      await storeDisconnect(id);
      clearSchema(id);
      clearDocument(id);
    },
    [storeDisconnect, clearSchema, clearDocument],
  );

  return { connect, disconnect };
}
