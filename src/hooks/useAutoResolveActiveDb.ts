import { useEffect, useRef } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useCurrentWindowConnectionId } from "@hooks/useCurrentWindowConnectionId";
import { hasConnectionCapability } from "@/types/dataSource";
import { listDatabases } from "@/lib/api/listDatabases";
import { switchActiveDb } from "@/lib/api/switchActiveDb";
import { logger } from "@/lib/logger";

/**
 * Heal a connected switch-capable RDB window that has no active database.
 *
 * A connection created with an empty `database` field opens a pool but leaves
 * `activeStatuses[id]` as bare `{ type: "connected" }` (no `activeDb`). The
 * workspace key then derives `db=""`, and `useSchemaCache` skips the whole
 * schema load — blank schema tree + blank grid. `connectToDatabase` seeds
 * `activeDb` only on the *connect* action, so a webview reload (which
 * re-hydrates the connected status but never re-runs connect) stays broken.
 *
 * This is a state-reactive effect (not a connect-time action) so it also fires
 * after reload once the hydrated `{ type: "connected" }` status is in the
 * store, then persists via `setActiveDb` → `persistActiveStatuses` so the
 * *next* reload is already healed.
 *
 * Scope: RDB switch-capable only (postgresql / mysql / mariadb). document
 * (Mongo) and search (ES) keep DB scope elsewhere and have no `switchDatabase`
 * capability; kv (Redis/Valkey) is switch-capable but paradigm "kv" with its
 * own numeric "0" fallback — the `paradigm === "rdb"` guard excludes it.
 * Non-switch-capable RDB (sqlite/duckdb/mssql/oracle) render a read-only
 * switcher and are excluded by the capability check.
 *
 * Keyed on `useCurrentWindowConnectionId()` (the window's pinned connection),
 * NOT the DbSwitcher's cross-window `focusedConnId` — the schema tree derives
 * its `(connId, db)` key from the window label too, so this targets exactly
 * the connection whose schema load is blocked.
 */
export function useAutoResolveActiveDb(): void {
  const connId = useCurrentWindowConnectionId();
  const connection = useConnectionStore((s) =>
    connId ? (s.connections.find((c) => c.id === connId) ?? null) : null,
  );
  const status = useConnectionStore((s) =>
    connId ? s.activeStatuses[connId] : undefined,
  );
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);

  // Once-per-connection guard: an empty list / rejection must not loop. Set is
  // component-instance scoped, so a reload (remount) re-attempts — the
  // self-heal path. Same shape as useSchemaCache's autoLoadedRef.
  const attemptedRef = useRef<Set<string>>(new Set());

  const isConnected = status?.type === "connected";
  const activeDb = status?.type === "connected" ? status.activeDb : undefined;
  const paradigm = connection?.paradigm ?? null;
  const supportsSwitching = hasConnectionCapability(
    connection?.dbType,
    "switchDatabase",
  );

  useEffect(() => {
    if (!connId) return;
    if (paradigm !== "rdb" || !supportsSwitching) return;
    if (!isConnected) return;
    if (activeDb) return; // already resolved — no-op
    if (attemptedRef.current.has(connId)) return; // once per connection
    attemptedRef.current.add(connId);

    void (async () => {
      try {
        const dbs = await listDatabases(connId);
        const first = dbs[0];
        if (!first) return; // empty list — leave read-only, guard blocks retry
        // Order matters (schemaStore.ts:56 contract): the backend must swap
        // the active sub-pool *before* the frontend records the activeDb, or
        // the schema cache keys ahead of the pool.
        await switchActiveDb(connId, first.name);
        setActiveDb(connId, first.name);
      } catch (err) {
        // Best-effort: a failed list/switch leaves the switcher read-only.
        // The ref guard already blocks a re-attempt within this mount.
        logger.warn(
          `[useAutoResolveActiveDb] auto-resolve failed for ${connId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    })();
  }, [connId, paradigm, supportsSwitching, isConnected, activeDb, setActiveDb]);
}
