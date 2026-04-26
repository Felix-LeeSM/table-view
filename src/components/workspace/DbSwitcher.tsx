import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Database, Loader2 } from "lucide-react";
import { useActiveTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { listDatabases } from "@/lib/api/listDatabases";
import { switchActiveDb } from "@/lib/api/switchActiveDb";
import { toast } from "@/lib/toast";
import type { DatabaseInfo } from "@/types/document";

/**
 * Sprint 127 — read-only DB display in the workspace toolbar.
 *
 * Sprint 128 promoted this into a click-to-fetch picker for `rdb` /
 * `document` paradigms when the active tab's connection is **connected**.
 * Sprint 130 wires the real PG sub-pool swap: a click on a list entry
 * dispatches `switch_active_db(connection_id, db_name)`, then
 *   1. updates `connectionStore.activeStatuses[id].activeDb`
 *   2. clears the schema cache for the connection (sidebar re-loads
 *      against the new DB)
 *   3. closes the popover
 *   4. surfaces a success toast
 * On failure (Document paradigm = `Unsupported` until S131; PG sub-pool
 * open failure) we keep the popover open so the error chip is visible
 * and surface a toast.
 *
 * Other paradigms (`search`, `kv`) and disconnected tabs keep the S127
 * read-only chrome — `aria-disabled="true"`, not in keyboard tab order.
 *
 * Resolution rules for the trigger label:
 *   - Connected RDB connection → `activeStatuses[id].activeDb`
 *                                (set by `setActiveDb` after a successful
 *                                 switch, seeded with `connection.database`
 *                                 on connect).
 *   - Document-paradigm query tab → `tab.database` (Mongo db name).
 *   - Fallback (legacy table tab) → `tab.schema` for back-compat.
 *   - No active tab               → "—"
 *   - Active tab but no value     → "(default)"
 */
const READ_ONLY_TOOLTIP = "Switching DBs lands in sprint 130";

export default function DbSwitcher() {
  const activeTab = useActiveTab();
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);

  const activeConn = activeTab
    ? (connections.find((c) => c.id === activeTab.connectionId) ?? null)
    : null;
  const status = activeConn ? activeStatuses[activeConn.id] : undefined;
  const isConnected = status?.type === "connected";
  const paradigm = activeConn?.paradigm ?? null;
  const supportsSwitching = paradigm === "rdb" || paradigm === "document";
  const enabled = supportsSwitching && isConnected;
  // Sprint 130 — RDB connections expose the active sub-pool via
  // `activeStatuses[id].activeDb`. We pick that as the primary label
  // source so the chip updates immediately after a successful switch.
  const activeDb = status?.type === "connected" ? status.activeDb : undefined;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Track the last `(connectionId, paradigm)` pair we fetched against so a
  // tab swap to a different connection invalidates the cached list (the
  // contract forbids LRU caching but stale rendering across connections is
  // a UX bug — Sprint 130 introduces a proper LRU layer).
  const lastFetchKeyRef = useRef<string | null>(null);

  // Reset the popover state whenever the active tab swaps to a different
  // connection or paradigm — the cached list belongs to the previous
  // connection and would mislead the user otherwise. Closing the popover
  // also avoids a flash of stale entries when the user reopens it.
  useEffect(() => {
    const key = activeConn ? `${activeConn.id}:${paradigm ?? ""}` : null;
    if (key !== lastFetchKeyRef.current) {
      setDatabases([]);
      setErrorMessage(null);
      setOpen(false);
      lastFetchKeyRef.current = null;
    }
  }, [activeConn, paradigm]);

  let label: string;
  if (!activeTab) {
    label = "—";
  } else if (paradigm === "rdb" && activeDb) {
    // Sprint 130 — RDB label always tracks the active sub-pool, not the
    // tab's `schema`. `schema` and DB are orthogonal in PG and the
    // toolbar must reflect *DB* selection.
    label = activeDb;
  } else if (activeTab.type === "query" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab.type === "table" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab.type === "table" && activeTab.schema) {
    // Legacy fallback for table tabs persisted before S130 that have no
    // `database` field yet. Schema doubles as a passable "current DB"
    // hint for the user until they reopen the tab.
    label = activeTab.schema;
  } else {
    label = "(default)";
  }

  const fetchList = useCallback(async () => {
    if (!activeConn) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const result = await listDatabases(activeConn.id);
      setDatabases(result);
      lastFetchKeyRef.current = `${activeConn.id}:${paradigm ?? ""}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMessage(message);
      // Sprint 128 — design bar requires a non-silent failure surface so
      // the user can see *why* the switcher didn't open. The inline error
      // chip below renders the same message; the toast is a redundant
      // surface for users who clicked outside before reading the popover.
      toast.error(`Failed to list databases: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [activeConn, paradigm]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!enabled) return;
      setOpen(next);
      if (next) {
        // Click marks the start of a fresh fetch — Sprint 128's contract
        // explicitly bans an LRU cache, so every popover open re-fetches.
        void fetchList();
      }
    },
    [enabled, fetchList],
  );

  const handleSelect = useCallback(
    async (dbName: string) => {
      // Sprint 130 — real switch dispatch. Successful path:
      //   1. backend swaps the active sub-pool (PG)
      //   2. `setActiveDb` flips the trigger label
      //   3. `clearForConnection` drops the schema cache so the sidebar
      //      reloads against the new DB
      //   4. close popover + success toast
      // Failure path (Document paradigm until S131, or PG pool-open
      // error): leave the popover open so the inline error chip can
      // render alongside the toast — the user may want to re-try a
      // different db without losing the list.
      if (!activeConn) return;
      if (dbName === activeDb) {
        // Re-selecting the active DB is a no-op — nothing to dispatch.
        // Closing the popover is enough; we keep the success toast
        // out of this branch so the user isn't told something
        // happened when nothing did.
        setOpen(false);
        return;
      }
      try {
        await switchActiveDb(activeConn.id, dbName);
        setActiveDb(activeConn.id, dbName);
        useSchemaStore.getState().clearForConnection(activeConn.id);
        setOpen(false);
        toast.success(`Switched to "${dbName}".`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(`Failed to switch DB: ${message}`);
      }
    },
    [activeConn, activeDb, setActiveDb],
  );

  // Read-only fallback — Search/Kv paradigms, no connection, or
  // disconnected tab. Preserves the S127 chrome verbatim so the toolbar
  // does not shift footprint between sprints.
  if (!enabled) {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              aria-label="Active database (read-only)"
              aria-disabled="true"
              data-disabled="true"
              tabIndex={-1}
              title={READ_ONLY_TOOLTIP}
              className="inline-flex h-7 min-w-[8rem] cursor-not-allowed items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground opacity-70 select-none"
            >
              <span className="flex items-center gap-2 truncate">
                <Database
                  size={12}
                  className="shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="truncate">{label}</span>
              </span>
              <ChevronDown
                size={14}
                className="shrink-0 opacity-50"
                aria-hidden
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{READ_ONLY_TOOLTIP}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Active database switcher"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-busy={loading || undefined}
          className="inline-flex h-7 min-w-[8rem] items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring select-none"
        >
          <span className="flex items-center gap-2 truncate">
            {loading ? (
              <Loader2
                size={12}
                className="shrink-0 animate-spin text-muted-foreground"
                aria-label="Loading databases"
              />
            ) : (
              <Database
                size={12}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
            )}
            <span className="truncate">{label}</span>
          </span>
          <ChevronDown size={14} className="shrink-0 opacity-50" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading databases…
          </div>
        ) : errorMessage ? (
          <div
            role="alert"
            data-testid="db-switcher-error"
            className="rounded-sm bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
          >
            {errorMessage}
          </div>
        ) : databases.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No databases available.
          </div>
        ) : (
          <ul
            role="listbox"
            aria-label="Available databases"
            className="flex flex-col"
          >
            {databases.map((db, idx) => (
              <li key={db.name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={db.name === label}
                  data-active={db.name === label || undefined}
                  // Sprint 130 — real swap dispatch. Pin autofocus on the
                  // first row so keyboard users can hit Enter immediately
                  // on open.
                  autoFocus={idx === 0}
                  onClick={() => {
                    void handleSelect(db.name);
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none data-[active]:font-medium"
                >
                  <Database
                    size={12}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="truncate">{db.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
