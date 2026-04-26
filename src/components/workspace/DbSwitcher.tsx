import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Database, Loader2 } from "lucide-react";
import { useActiveTab } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
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
import { toast } from "@/lib/toast";
import type { DatabaseInfo } from "@/types/document";

/**
 * Sprint 127 — read-only DB display in the workspace toolbar.
 *
 * Sprint 128 promotes this into a click-to-fetch picker for `rdb` /
 * `document` paradigms when the active tab's connection is **connected**.
 * The selection itself is still a no-op (S130/S131 wire the actual
 * sub-pool / `use_db` swap); clicking an entry surfaces a toast hint so
 * the user knows the feature is intentional shippable scaffolding.
 *
 * Other paradigms (`search`, `kv`) and disconnected tabs keep the S127
 * read-only chrome — `aria-disabled="true"`, not in keyboard tab order.
 *
 * Resolution rules for the trigger label:
 *   - Document-paradigm query tab → `tab.database`
 *   - RDB-paradigm tabs           → `tab.schema` (PG schema doubles as
 *                                    "current database" placeholder; S130
 *                                    introduces a real `current_database()`
 *                                    surface)
 *   - No active tab               → "—"
 *   - Active tab but no value     → "(default)"
 */
const SELECT_HINT_MESSAGE = "Switching active DB lands in sprint 130";
const READ_ONLY_TOOLTIP = "Switching DBs lands in sprint 130";

export default function DbSwitcher() {
  const activeTab = useActiveTab();
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);

  const activeConn = activeTab
    ? (connections.find((c) => c.id === activeTab.connectionId) ?? null)
    : null;
  const isConnected =
    activeConn !== null && activeStatuses[activeConn.id]?.type === "connected";
  const paradigm = activeConn?.paradigm ?? null;
  const supportsSwitching = paradigm === "rdb" || paradigm === "document";
  const enabled = supportsSwitching && isConnected;

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
  } else if (activeTab.type === "query" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab.type === "table" && activeTab.schema) {
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

  const handleSelect = useCallback(() => {
    // Sprint 128 — selection is intentionally a no-op. S130/S131 wire the
    // real swap (PG sub-pool / Mongo `use_db`); until then we surface a
    // toast hint so the user understands the click was registered. No
    // store mutation happens here; the unit test asserts that
    // `useTabStore.getState()` is byte-identical before/after the click.
    toast.info(SELECT_HINT_MESSAGE);
    setOpen(false);
  }, []);

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
                  // Sprint 128 — every option click is a no-op + hint
                  // surface. S130 will replace `handleSelect` with a real
                  // swap action; we pin the autofocus on the first row so
                  // keyboard users can hit Enter immediately on open.
                  autoFocus={idx === 0}
                  onClick={handleSelect}
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
        <div
          role="note"
          data-testid="db-switcher-hint"
          className="mt-1 border-t border-border px-2 pt-1.5 text-xs leading-tight text-muted-foreground"
        >
          {SELECT_HINT_MESSAGE}
        </div>
      </PopoverContent>
    </Popover>
  );
}
