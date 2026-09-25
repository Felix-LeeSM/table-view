import i18n from "@lib/i18n";
import { toast } from "@lib/runtime/toast";
import { useConnectionStore } from "@stores/connectionStore";
import { useCallback } from "react";
import type { ConnectionConfig, ConnectionDraft } from "@/types/connection";

/**
 * Use-case hook that owns the user-facing toast notifications for
 * connection mutations (`addConnection` / `updateConnection` /
 * `removeConnection`), keeping them out of `connectionStore.ts`.
 *
 * Toasts are published after the store action's set(...) settles, on the
 * success path only. On a store throw the hook re-propagates without firing
 * a toast so the dialog's catch can render the error inline.
 *
 * The hook is pure orchestration — no useEffect / setInterval / setTimeout /
 * subscribe / window event listener. Cross-window sync:
 * `attachZustandIpcBridge` broadcasts state mutations on
 * `connection-sync`; the receiving window does NOT call this hook, so it
 * does NOT toast.
 *
 * `removeConnection`: the display name must be resolved BEFORE awaiting the
 * store action — once the store removes the connection from `connections`,
 * the lookup would yield `undefined` and we'd land on the fallback toast
 * text. When the id is genuinely unresolvable (e.g. already gone), fall
 * back to "Connection removed." (without the name).
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
      toast.success(
        i18n.t("featuresConnection:mutations.added", { name: saved.name }),
      );
      return saved;
    },
    [storeAdd],
  );

  const updateConnection = useCallback(
    async (draft: ConnectionDraft): Promise<void> => {
      await storeUpdate(draft);
      toast.success(
        i18n.t("featuresConnection:mutations.updated", { name: draft.name }),
      );
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
          ? i18n.t("featuresConnection:mutations.removed", {
              name: removed.name,
            })
          : i18n.t("featuresConnection:mutations.removedFallback"),
      );
    },
    [storeRemove],
  );

  return { addConnection, updateConnection, removeConnection };
}
