/**
 * Sprint 256 (ADR 0023, AC-256-02 / AC-256-03) — `useActiveTabConnection`.
 *
 * Combines `useTabStore.activeTabId` + `useConnectionStore.connections`
 * into a single "the connection backing the currently-focused tab"
 * subscription. Drives `App.tsx` prod-only 1px window border and provides
 * the env signal feeding `<ExecuteButton>` callsites that resolve their
 * own connection via the same store.
 *
 * Returns `null` when (a) no active tab, or (b) the active tab references
 * a connection that no longer exists (race after `removeConnection`).
 * Re-subscribes both stores so the chrome / button colour update on the
 * very next render whenever `activeTabId` or the connection list mutates.
 */
import type { ConnectionConfig } from "@/types/connection";
import { useConnectionStore } from "@stores/connectionStore";
// #1447 — sql-free read: only `connectionId` is consumed, so App (the
// subscriber driving the prod border) must not re-render per keystroke.
import { useActiveTabSansSql } from "@stores/workspaceStore";

export function useActiveTabConnection(): ConnectionConfig | null {
  const activeTab = useActiveTabSansSql();
  const tabConnectionId = activeTab?.connectionId ?? null;
  const connection = useConnectionStore((s) =>
    tabConnectionId
      ? (s.connections.find((c) => c.id === tabConnectionId) ?? null)
      : null,
  );
  if (!activeTab) return null;
  return connection;
}
