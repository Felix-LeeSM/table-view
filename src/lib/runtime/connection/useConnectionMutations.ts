import { useCallback } from "react";
import type { ConnectionConfig, ConnectionDraft } from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
import { toast } from "@lib/runtime/toast";

/**
 * Sprint 219 (P10 step 1) — moves the user-facing toast notifications for
 * connection mutations (`addConnection` / `updateConnection` /
 * `removeConnection`) out of `connectionStore.ts` and into a use-case hook.
 *
 * Behaviour change 0 — the same toast text is published at the same point
 * (after the store action's set(...) settles, on the success path only). On
 * a store throw the hook re-propagates without firing a toast so the
 * dialog's catch can render the error inline.
 *
 * The hook is pure orchestration — no useEffect / setInterval / setTimeout /
 * subscribe / window event listener. Cross-window sync is unaffected:
 * `attachZustandIpcBridge` still broadcasts state mutations on
 * `connection-sync`; the receiving window does NOT call this hook, so it
 * does NOT toast (byte-equivalent to the previous behaviour where the
 * receiving window's store action was never invoked either).
 *
 * `removeConnection`: the display name must be resolved BEFORE awaiting the
 * store action — once the store removes the connection from `connections`,
 * the lookup would yield `undefined` and we'd land on the fallback toast
 * text. When the id is genuinely unresolvable (e.g. already gone), fall
 * back to "Connection removed." (without the name), matching the
 * pre-extraction store behaviour.
 */
export function useConnectionMutations(): {
  addConnection: (draft: ConnectionDraft) => Promise<ConnectionConfig>;
  updateConnection: (draft: ConnectionDraft) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;
} {
  const storeAdd = useConnectionStore((s) => s.addConnection);
  const storeUpdate = useConnectionStore((s) => s.updateConnection);
  const storeRemove = useConnectionStore((s) => s.removeConnection);

  const addConnection = useCallback(
    async (draft: ConnectionDraft): Promise<ConnectionConfig> => {
      const saved = await storeAdd(draft);
      toast.success(`Connection "${saved.name}" added.`);
      return saved;
    },
    [storeAdd],
  );

  const updateConnection = useCallback(
    async (draft: ConnectionDraft): Promise<void> => {
      await storeUpdate(draft);
      toast.success(`Connection "${draft.name}" updated.`);
    },
    [storeUpdate],
  );

  const removeConnection = useCallback(
    async (id: string): Promise<void> => {
      // Snapshot the name BEFORE awaiting the store — once the action
      // resolves, the connection is gone from `connections` and the lookup
      // would land on the fallback string.
      const removed = useConnectionStore
        .getState()
        .connections.find((c) => c.id === id);
      await storeRemove(id);
      toast.success(
        removed
          ? `Connection "${removed.name}" removed.`
          : "Connection removed.",
      );
    },
    [storeRemove],
  );

  return { addConnection, updateConnection, removeConnection };
}
