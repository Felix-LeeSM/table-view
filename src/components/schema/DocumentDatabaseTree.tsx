import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@components/ui/button";
import { useDocumentStore } from "@stores/documentStore";
import { useTabStore } from "@stores/tabStore";
import { cn } from "@lib/utils";

interface DocumentDatabaseTreeProps {
  connectionId: string;
}

/**
 * Sprint 66 — two-level tree for the document paradigm.
 *
 * Level 1: databases (listed by `list_mongo_databases`).
 * Level 2: collections (fetched on-demand by `list_mongo_collections` when a
 * database node is expanded for the first time).
 *
 * Double-clicking a collection opens a TableTab with `paradigm: "document"`
 * so the MainArea can route to the mongo read path. Single-click only
 * selects without opening a tab, matching the RDB tree convention.
 *
 * Sprint 129 — RDB-folder metaphor (Folder/FolderOpen) removed in favour of
 * a single `Database` icon per row. A client-side search input filters the
 * tree by database name OR collection name (collection match auto-expands
 * the parent database).
 */
export default function DocumentDatabaseTree({
  connectionId,
}: DocumentDatabaseTreeProps) {
  const databases = useDocumentStore((s) => s.databases[connectionId]);
  const collectionsByDb = useDocumentStore((s) => s.collections);
  const loadDatabases = useDocumentStore((s) => s.loadDatabases);
  const loadCollections = useDocumentStore((s) => s.loadCollections);
  const addTab = useTabStore((s) => s.addTab);

  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingDbs, setLoadingDbs] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const autoLoadedRef = useRef<string | null>(null);

  // Auto-load databases when the connection changes.
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingRoot(true);
    loadDatabases(connectionId).finally(() => setLoadingRoot(false));
  }, [connectionId, loadDatabases]);

  const handleRefresh = useCallback(() => {
    setLoadingRoot(true);
    loadDatabases(connectionId).finally(() => setLoadingRoot(false));
  }, [connectionId, loadDatabases]);

  const handleExpandDb = useCallback(
    async (dbName: string) => {
      const isExpanded = expandedDbs.has(dbName);
      if (isExpanded) {
        setExpandedDbs((prev) => {
          const next = new Set(prev);
          next.delete(dbName);
          return next;
        });
        return;
      }
      setExpandedDbs((prev) => new Set(prev).add(dbName));
      const key = `${connectionId}:${dbName}`;
      if (!collectionsByDb[key]) {
        setLoadingDbs((prev) => new Set(prev).add(dbName));
        try {
          await loadCollections(connectionId, dbName);
        } finally {
          setLoadingDbs((prev) => {
            const next = new Set(prev);
            next.delete(dbName);
            return next;
          });
        }
      }
    },
    [expandedDbs, connectionId, collectionsByDb, loadCollections],
  );

  const handleCollectionOpen = useCallback(
    (dbName: string, collectionName: string) => {
      addTab({
        type: "table",
        title: `${dbName}.${collectionName}`,
        connectionId,
        closable: true,
        // Sprint 129 — primary fields for the document paradigm. Downstream
        // consumers (MainArea, future S130/S131 store wires) read these.
        database: dbName,
        collection: collectionName,
        // Legacy RDB-aliased fields. Persisted document tabs from sprint
        // <129 used these and `loadPersistedTabs` migrates them; we keep
        // writing them here for backwards-compat with any reader still on
        // the old field. New read sites must prefer `database`/`collection`.
        schema: dbName,
        table: collectionName,
        subView: "records",
        paradigm: "document",
      });
    },
    [addTab, connectionId],
  );

  /**
   * Sprint 136 (AC-S136-03) — double-click promotes the preview tab to a
   * persistent tab. We open / swap onto the target collection first via the
   * same `handleCollectionOpen` path, then read back the active tab id and
   * call `promoteTab` so the user can keep the tab around even when they
   * later click another collection.
   */
  const promoteTab = useTabStore((s) => s.promoteTab);
  const handleCollectionDoubleClick = useCallback(
    (dbName: string, collectionName: string) => {
      handleCollectionOpen(dbName, collectionName);
      const activeTabId = useTabStore.getState().activeTabId;
      if (activeTabId) {
        promoteTab(activeTabId);
      }
    },
    [handleCollectionOpen, promoteTab],
  );

  const databaseList = useMemo(() => databases ?? [], [databases]);

  // Sprint 129 — client-side filter. Empty query → show everything. A
  // database matches when its own name matches OR any of its already-loaded
  // collections match (in which case the database is auto-expanded for
  // visibility). Match is case-insensitive substring; we never fetch as a
  // side effect of typing.
  const trimmedQuery = searchQuery.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const isFiltering = trimmedQuery.length > 0;

  const filteredDatabases = useMemo(() => {
    if (!isFiltering) return databaseList;
    return databaseList.filter((db) => {
      if (db.name.toLowerCase().includes(lowerQuery)) return true;
      const key = `${connectionId}:${db.name}`;
      const collections = collectionsByDb[key] ?? [];
      return collections.some((c) => c.name.toLowerCase().includes(lowerQuery));
    });
  }, [databaseList, isFiltering, lowerQuery, collectionsByDb, connectionId]);

  // Auto-expand databases whose collection names match the active query so
  // the matched collection is visible without an extra click. We use a ref
  // to remember which databases were auto-expanded by search alone vs. by
  // the user, so clearing the query collapses them while leaving the user's
  // own expansion state intact.
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isFiltering) {
      // Clearing the filter — collapse anything we auto-expanded so the
      // tree returns to the user's last manual state.
      if (autoExpandedRef.current.size > 0) {
        const auto = autoExpandedRef.current;
        setExpandedDbs((prev) => {
          const next = new Set(prev);
          for (const name of auto) next.delete(name);
          return next;
        });
        autoExpandedRef.current = new Set();
      }
      return;
    }
    const toExpand: string[] = [];
    for (const db of databaseList) {
      const key = `${connectionId}:${db.name}`;
      const collections = collectionsByDb[key] ?? [];
      const hasCollectionMatch = collections.some((c) =>
        c.name.toLowerCase().includes(lowerQuery),
      );
      if (hasCollectionMatch && !expandedDbs.has(db.name)) {
        toExpand.push(db.name);
      }
    }
    if (toExpand.length === 0) return;
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      for (const name of toExpand) next.add(name);
      return next;
    });
    for (const name of toExpand) autoExpandedRef.current.add(name);
    // We deliberately omit `expandedDbs` from deps to avoid an infinite
    // loop after we add the auto-expanded entries; the next user toggle
    // re-syncs naturally on the following render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltering, lowerQuery, databaseList, collectionsByDb, connectionId]);

  return (
    <div className="flex flex-col select-none">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          Databases
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleRefresh}
          disabled={loadingRoot}
          aria-label="Refresh databases"
          title="Refresh databases"
        >
          {loadingRoot ? (
            <Loader2 className="animate-spin" size={12} />
          ) : (
            <RefreshCw size={12} />
          )}
        </Button>
      </div>

      <div className="px-3 pb-1">
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              setSearchQuery("");
            }
          }}
          placeholder="Filter databases and collections"
          aria-label="Filter databases and collections"
          className={cn(
            "h-6 w-full rounded border border-input bg-background px-2 text-xs",
            "placeholder:text-muted-foreground/70",
            "focus:outline-none focus:ring-1 focus:ring-ring",
          )}
        />
      </div>

      {loadingRoot && databaseList.length === 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2 className="animate-spin" size={12} />
          <span>Loading databases...</span>
        </div>
      )}

      {!loadingRoot && databaseList.length === 0 && (
        <div className="px-3 py-2 text-xs italic text-muted-foreground">
          No databases visible to this connection
        </div>
      )}

      {!loadingRoot &&
        databaseList.length > 0 &&
        filteredDatabases.length === 0 && (
          <div
            className="px-3 py-2 text-xs italic text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            No databases match &quot;{trimmedQuery}&quot;
          </div>
        )}

      {filteredDatabases.map((db) => {
        const isExpanded = expandedDbs.has(db.name);
        const isLoading = loadingDbs.has(db.name);
        const key = `${connectionId}:${db.name}`;
        const allCollections = collectionsByDb[key] ?? [];
        // Filter collections by the same query so a db that matched only
        // because of a collection sub-match shows just the matching ones.
        // When the search matches the database name itself we still show
        // all of its collections so the user has the full picture.
        const dbNameMatches =
          !isFiltering || db.name.toLowerCase().includes(lowerQuery);
        const collections =
          isFiltering && !dbNameMatches
            ? allCollections.filter((c) =>
                c.name.toLowerCase().includes(lowerQuery),
              )
            : allCollections;
        const dbNodeId = `db:${db.name}`;
        const isDbSelected = selectedNodeId === dbNodeId;

        return (
          <div key={db.name}>
            <button
              type="button"
              className={cn(
                "flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted",
                isDbSelected
                  ? "bg-muted text-foreground"
                  : "text-secondary-foreground",
              )}
              aria-expanded={isExpanded}
              aria-label={`${db.name} database`}
              onClick={() => {
                setSelectedNodeId(dbNodeId);
                handleExpandDb(db.name);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedNodeId(dbNodeId);
                  handleExpandDb(db.name);
                }
              }}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0" />
              ) : (
                <ChevronRight size={12} className="shrink-0" />
              )}
              <DbIcon size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{db.name}</span>
              {isLoading && (
                <Loader2 size={10} className="ml-auto animate-spin" />
              )}
            </button>

            {isExpanded && (
              <div>
                {isLoading && allCollections.length === 0 ? (
                  <div className="px-8 py-1 text-xs text-muted-foreground">
                    Loading...
                  </div>
                ) : collections.length === 0 ? (
                  <div className="px-8 py-1 text-2xs italic text-muted-foreground">
                    {isFiltering && allCollections.length > 0
                      ? "No matching collections"
                      : "No collections"}
                  </div>
                ) : (
                  collections.map((coll) => {
                    const collNodeId = `coll:${db.name}:${coll.name}`;
                    const isSelected = selectedNodeId === collNodeId;
                    return (
                      <button
                        key={coll.name}
                        type="button"
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-8 hover:bg-muted",
                          isSelected
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-foreground",
                        )}
                        aria-label={`${coll.name} collection`}
                        // Sprint 136 (AC-S136-03) — single-click opens a
                        // preview tab on the collection (`addTab` defaults
                        // new tabs to `isPreview: true`); double-click
                        // promotes the preview tab to a persistent tab.
                        // Same model as the relational tree (AC-S136-01/02)
                        // so paradigm doesn't change the click semantics.
                        onClick={() => {
                          setSelectedNodeId(collNodeId);
                          handleCollectionOpen(db.name, coll.name);
                        }}
                        onDoubleClick={() =>
                          handleCollectionDoubleClick(db.name, coll.name)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleCollectionOpen(db.name, coll.name);
                          }
                        }}
                      >
                        <FileText
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate text-xs">{coll.name}</span>
                        {coll.document_count != null && (
                          <span className="ml-auto text-3xs text-muted-foreground">
                            {coll.document_count.toLocaleString()}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
