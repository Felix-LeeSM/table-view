import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, Database, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useActiveTab } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
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
import { toast } from "@/lib/runtime/toast";
import type { DatabaseInfo } from "@/types/document";
import type { DatabaseType, Paradigm } from "@/types/connection";
import { hasConnectionCapability } from "@/types/dataSource";

/**
 * DB switcher in the workspace toolbar. For connected profiles that expose the
 * switch-database capability it's a click-to-fetch picker; clicking an entry
 * dispatches
 * `switch_active_db(connection_id, db_name)`, then:
 *   1. updates `connectionStore.activeStatuses[id].activeDb`
 *   2. clears the schema cache for the connection (sidebar re-loads against
 *      the new DB)
 *   3. closes the popover
 *   4. surfaces a success toast
 * On failure (Document `Unsupported`, PG sub-pool open error) the popover
 * stays open so the error chip stays visible alongside the toast.
 *
 * Fixed-scope profiles and disconnected tabs render the read-only chrome —
 * `aria-disabled="true"`, not in keyboard tab order.
 *
 * Resolution rules for the trigger label:
 *   - Connected RDB connection → `activeStatuses[id].activeDb`
 *                                (set by `setActiveDb` after a successful
 *                                 switch, seeded with `connection.database`
 *                                 on connect).
 *   - Document-paradigm query tab → `tab.database` (Mongo db name; rendered by
 *                                    the tab-local chip, not this toolbar).
 *   - Fallback (legacy table tab) → `tab.schema` for back-compat.
 *   - No active tab               → "—"
 *   - Active tab but no value     → "(default)"
 */
/**
 * Paradigm- and state-aware tooltip copy for the read-only fallback. Each
 * branch surfaces the *user-visible* reason the switcher is non-interactive
 * (no internal milestone references in user-facing copy).
 */
function readOnlyTooltipCopy(
  args: {
    hasActiveTab: boolean;
    paradigm: Paradigm | null;
    dbType: DatabaseType | null;
    isConnected: boolean;
  },
  t: (key: string) => string,
): string {
  if (!args.hasActiveTab) {
    return t("dbSwitcher.tooltip.noTab");
  }
  if (args.paradigm === "search") {
    return t("dbSwitcher.tooltip.searchParadigm");
  }
  if (args.paradigm === "document") {
    return t("dbSwitcher.tooltip.documentParadigm");
  }
  if (args.dbType === "sqlite") {
    return t("dbSwitcher.tooltip.sqlite");
  }
  if (!args.isConnected) {
    return t("dbSwitcher.tooltip.notConnected");
  }
  return t("dbSwitcher.tooltip.unavailable");
}

export default function DbSwitcher() {
  const { t } = useTranslation("workspace");
  const activeTab = useActiveTab();
  const connections = useConnectionStore((s) => s.connections);
  const activeStatuses = useConnectionStore((s) => s.activeStatuses);
  const setActiveDb = useConnectionStore((s) => s.setActiveDb);
  const clearDocumentCatalogConnection = useDocumentCatalogStore(
    (s) => s.clearConnection,
  );
  const clearDocumentQueryConnection = useDocumentQueryStore(
    (s) => s.clearConnection,
  );
  // When no active tab is open, fall back to the focused connection so the
  // switcher shows the database name immediately after opening the workspace
  // (before any table/collection is clicked).
  const focusedConnId = useConnectionStore((s) => s.focusedConnId);

  // Resolve the "driving" connection: active tab's connection first, then
  // focused connection as fallback (mirrors WorkspaceSidebar's resolution).
  const activeConn = activeTab
    ? (connections.find((c) => c.id === activeTab.connectionId) ?? null)
    : focusedConnId
      ? (connections.find((c) => c.id === focusedConnId) ?? null)
      : null;
  const status = activeConn ? activeStatuses[activeConn.id] : undefined;
  const isConnected = status?.type === "connected";
  const paradigm = activeConn?.paradigm ?? null;
  const supportsSwitching = hasConnectionCapability(
    activeConn?.dbType,
    "switchDatabase",
  );
  const enabled = supportsSwitching && isConnected;
  // RDB connections expose the active sub-pool via
  // `activeStatuses[id].activeDb`. We pick that as the primary label
  // source so the chip updates immediately after a successful switch.
  const activeDb = status?.type === "connected" ? status.activeDb : undefined;

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Roving-tabindex anchor for the listbox: index of the currently-focusable
  // option. The list is a single tab stop; ArrowUp/Down + Home/End move it.
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLUListElement | null>(null);
  // Track the last `(connectionId, paradigm)` pair we fetched against so a
  // tab swap to a different connection invalidates the cached list (we do
  // not LRU-cache the list, but stale rendering across connections is a
  // UX bug).
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
  if (!activeConn) {
    // No active tab AND no focused connection — nothing to show.
    label = "—";
  } else if (paradigm === "rdb" && activeDb) {
    label = activeDb;
  } else if (activeTab?.type === "query" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab?.type === "table" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab?.type === "table" && activeTab.schema) {
    label = activeTab.schema;
  } else if (activeDb) {
    // Focused connection (or active tab on a document connection) with no
    // tab-specific database — use the connection's activeDb.
    label = activeDb;
  } else {
    label = t("dbSwitcher.defaultLabel");
  }

  // Anchor the roving index on the active db when the list (re)loads and pull
  // DOM focus onto it, so the first Arrow key moves from the selection rather
  // than the top. When the popover is closed the `<ul>` is unmounted, so the
  // focus call is a no-op (optional chaining on a null ref).
  useEffect(() => {
    if (databases.length === 0) return;
    const sel = databases.findIndex((db) => db.name === label);
    const idx = sel >= 0 ? sel : 0;
    setActiveIndex(idx);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${idx}"]`)
      ?.focus();
  }, [databases, label]);

  // ponytail: Arrow/Home/End roving only — no typeahead (add if users ask;
  // the db list is short and label-sorted).
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const { key } = e;
    if (
      key !== "ArrowDown" &&
      key !== "ArrowUp" &&
      key !== "Home" &&
      key !== "End"
    )
      return;
    if (databases.length === 0) return;
    e.preventDefault();
    const last = databases.length - 1;
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? last
          : key === "ArrowDown"
            ? Math.min(activeIndex + 1, last)
            : Math.max(activeIndex - 1, 0);
    setActiveIndex(next);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-option-index="${next}"]`)
      ?.focus();
  };

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
      // Non-silent failure surface so the user can see *why* the switcher
      // didn't open. The inline error chip below renders the same message;
      // the toast is a redundant surface for users who clicked outside
      // before reading the popover.
      toast.error(t("dbSwitcher.toast.listFailed", { message }));
    } finally {
      setLoading(false);
    }
  }, [activeConn, paradigm, t]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!enabled) return;
      setOpen(next);
      if (next) {
        // Every popover open re-fetches — list is not LRU-cached.
        void fetchList();
      }
    },
    [enabled, fetchList],
  );

  const handleSelect = useCallback(
    async (dbName: string) => {
      // Successful path:
      //   1. backend swaps the active sub-pool (PG)
      //   2. `setActiveDb` flips the trigger label
      //   3. close popover + success toast
      // Sprint 263 — schemaStore caches are now `(connId, db)` keyed, so a
      // DB toggle no longer needs to wipe the whole connection's cache.
      // The sidebar re-subscribes to the new slot via the workspace key;
      // an already-populated slot is reused instantly. Document store
      // still uses a connection-scoped cache, so its clear-on-switch path
      // remains (until Mongo migrates to the same shape — see Sprint 263
      // Out of Scope).
      // Failure path: leave the popover open so the inline error chip can
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
        if (paradigm === "document") {
          clearDocumentCatalogConnection(activeConn.id);
          clearDocumentQueryConnection(activeConn.id);
        }
        setOpen(false);
        toast.success(t("dbSwitcher.toast.switched", { dbName }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error(t("dbSwitcher.toast.switchFailed", { message }));
      }
    },
    [
      activeConn,
      activeDb,
      paradigm,
      setActiveDb,
      clearDocumentCatalogConnection,
      clearDocumentQueryConnection,
      t,
    ],
  );

  // #1047 — Mongo (document) paradigm keeps DB scope tab-local (ADR 0030,
  // surfaced by `TabDbChip`), so it never gets an interactive toolbar
  // switcher. It falls through to the read-only chip below (document has no
  // `switchDatabase` capability → `enabled` is false) with a tab-local
  // tooltip, instead of the former `return null` that violated the
  // ui-parity gate (same action = same entry point, unsupported shown with
  // a reason). See `docs/explorations/mongo-db-scope-patterns.html`.

  // Read-only fallback — fixed-scope profiles, no connection, or disconnected
  // tab. KV profiles do not belong here when connected; Redis/Valkey expose the
  // numeric database index through the same active switcher.
  if (!enabled) {
    // Paradigm/state-aware copy via Radix Tooltip only — the native HTML
    // `title` attribute is omitted to avoid the "stuck tooltip" bug
    // (Radix dismisses on hover-out, native bubble does not).
    const tooltipCopy = readOnlyTooltipCopy(
      {
        hasActiveTab: !!activeTab,
        paradigm,
        dbType: activeConn?.dbType ?? null,
        isConnected,
      },
      t,
    );
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="button"
              aria-label={t("dbSwitcher.readOnlyAria")}
              aria-disabled="true"
              data-disabled="true"
              tabIndex={-1}
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
          <TooltipContent>{tooltipCopy}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("dbSwitcher.switcherAria")}
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
                aria-label={t("dbSwitcher.loadingDatabasesAria")}
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
            {t("dbSwitcher.loadingDatabases")}
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
            {t("dbSwitcher.noDatabases")}
          </div>
        ) : (
          <ul
            ref={listRef}
            role="listbox"
            aria-label={t("dbSwitcher.availableDatabases")}
            className="flex flex-col"
            onKeyDown={handleListKeyDown}
          >
            {databases.map((db, idx) => (
              <li key={db.name} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={db.name === label}
                  data-active={db.name === label || undefined}
                  data-option-index={idx}
                  // Single tab stop: only the roving anchor is tabbable;
                  // an effect pulls focus onto it (the selected db) on open.
                  tabIndex={idx === activeIndex ? 0 : -1}
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
