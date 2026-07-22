import { useCallback } from "react";
import { disconnectFromDatabase } from "@lib/tauri";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { useRawQueryGridEditStore } from "@stores/rawQueryGridEditStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionLifecycle } from "./useConnectionLifecycle";

/**
 * #1719 (Part of #1717) — Stage 2 hard refresh for one connection. Orchestration
 * (design SOT #1717, decision 2), in strict order:
 *
 *   1. Abandon this connection's in-flight + completed query results (running
 *      query tabs → idle) and drop grid pending edits — the intended result
 *      loss on a hard refresh. Resetting the running tabs before the teardown
 *      means the pool drop below can't surface a spurious query error; the
 *      querySlice queryId guard drops any late IPC resolve.
 *   2. Reconnect. A RAW `disconnect` (NOT the connection store's, whose
 *      `disconnected` transition fires the cleanup subscribe that would purge
 *      THIS window's tabs) tears the pool down first — cancelling every
 *      in-flight statement server-side — then the store `connect` (via
 *      `useConnectionLifecycle`, which also invalidates the schema/document
 *      caches) rebuilds it. `connect`/`disconnect` never emit
 *      `connection-status-changed`, so the store status stays `connected` and
 *      the open tabs / SQL / connection selection survive.
 *   3. Refetch the active resource + schema tree through the Stage 1 window
 *      events — skipped when the reconnect failed (status now `error`, no live
 *      pool to fetch against).
 *
 * The discard-confirm gate lives at the call site (App), same as soft refresh.
 */
export function useHardRefresh(): (connectionId: string) => Promise<void> {
  const { connect } = useConnectionLifecycle();
  const resetQueryStates = useWorkspaceStore(
    (s) => s.resetQueryStatesForConnection,
  );
  const purgeDataGridPending = useDataGridEditStore(
    (s) => s.purgeForConnection,
  );
  const purgeRawGridPending = useRawQueryGridEditStore(
    (s) => s.purgeForConnection,
  );

  return useCallback(
    async (connectionId: string) => {
      resetQueryStates(connectionId);
      purgeDataGridPending(connectionId);
      purgeRawGridPending(connectionId);

      try {
        await disconnectFromDatabase(connectionId);
      } catch {
        // Best-effort teardown; the reconnect below rebuilds the pool and
        // disconnect()s any displaced adapter regardless (#1100).
      }

      const connected = await connect(connectionId);
      if (!connected) return;

      window.dispatchEvent(new CustomEvent("refresh-data"));
      window.dispatchEvent(new CustomEvent("refresh-structure"));
      window.dispatchEvent(new CustomEvent("refresh-schema"));
    },
    [connect, resetQueryStates, purgeDataGridPending, purgeRawGridPending],
  );
}
