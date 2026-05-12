// Sprint 262 Slice B (2026-05-12) — per-workspace scrollTop persistence
// for the sidebar's scroll container. Lives in `src/hooks/` (not `.tsx`)
// so the restore path can read `useWorkspaceStore.getState()` without
// running through a re-rendering selector — touching scrollTop every
// pixel of user scroll would loop with the selector. Project lint rule
// `no-restricted-syntax` bans `store.getState()` in component files
// precisely to push these one-shot reads behind a hook seam.

import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceStore, type WorkspaceKey } from "@stores/workspaceStore";

/**
 * Wire a scroll container to `workspace.sidebar.scrollTop` for the given
 * `(connId, db)` workspace key. Returns an `onScroll` handler suitable
 * for the container's `onScroll` prop.
 *
 * Behaviour:
 *   - On `workspaceKey` change (DB swap, connection refocus), reads the
 *     stored scrollTop **once** and applies it to `containerRef.current`.
 *   - Writes back to the store on every scroll event (no debounce —
 *     Zustand setState is cheap and the `setScrollTop` action already
 *     short-circuits identity equal writes).
 *   - `null` key (no focused / connected workspace) is a no-op for both
 *     directions.
 */
export function useSidebarScrollPersistence(
  containerRef: React.RefObject<HTMLDivElement | null>,
  workspaceKey: WorkspaceKey | null,
): () => void {
  const setScrollTop = useWorkspaceStore((s) => s.setScrollTop);
  // Guard one-shot restore so subsequent re-renders within the same
  // workspace key don't clobber the user's live scroll position with a
  // stale stored value.
  const lastRestoredKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!workspaceKey) return;
    const keyStr = `${workspaceKey.connId}:${workspaceKey.db}`;
    if (lastRestoredKeyRef.current === keyStr) return;
    lastRestoredKeyRef.current = keyStr;
    const stored =
      useWorkspaceStore.getState().workspaces[workspaceKey.connId]?.[
        workspaceKey.db
      ]?.sidebar.scrollTop ?? 0;
    if (containerRef.current) {
      containerRef.current.scrollTop = stored;
    }
  }, [workspaceKey, containerRef]);

  return useCallback(() => {
    if (!workspaceKey || !containerRef.current) return;
    setScrollTop(
      workspaceKey.connId,
      workspaceKey.db,
      containerRef.current.scrollTop,
    );
  }, [workspaceKey, setScrollTop, containerRef]);
}
