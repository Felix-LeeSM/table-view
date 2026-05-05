import { useCallback } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@components/ui/button";
import { useTabStore } from "@stores/tabStore";
import { useMruStore } from "@stores/mruStore";
import { cn } from "@lib/utils";
import { useDocumentDatabaseTreeData } from "./DocumentDatabaseTree/useDocumentDatabaseTreeData";
import { useDocumentDatabaseDrop } from "./DocumentDatabaseTree/useDocumentDatabaseDrop";
import { CollectionRow, DatabaseRow } from "./DocumentDatabaseTree/rows";
import { DropCollectionDialog } from "./DocumentDatabaseTree/dialogs";

interface DocumentDatabaseTreeProps {
  connectionId: string;
}

/**
 * Two-level tree for the document paradigm. Level 1: databases
 * (`list_mongo_databases`). Level 2: collections (fetched on-demand on
 * first expand).
 */
export default function DocumentDatabaseTree({
  connectionId,
}: DocumentDatabaseTreeProps) {
  const addTab = useTabStore((s) => s.addTab);
  // MRU marking is the caller's responsibility — `addTab` no longer emits
  // it implicitly, so each tab-open path here pairs the call.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const tree = useDocumentDatabaseTreeData(connectionId);
  const drop = useDocumentDatabaseDrop(connectionId);

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
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
  );

  /**
   * Double-click on a collection opens it as a persistent tab directly via
   * `addTab({ permanent: true })`. This replaces the old two-step
   * addTab+promoteTab pattern so the lifecycle is managed entirely within
   * the store.
   */
  const handleCollectionDoubleClick = useCallback(
    (dbName: string, collectionName: string) => {
      addTab({
        type: "table",
        title: `${dbName}.${collectionName}`,
        connectionId,
        closable: true,
        database: dbName,
        collection: collectionName,
        schema: dbName,
        table: collectionName,
        subView: "records",
        paradigm: "document",
        permanent: true,
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
  );

  const {
    databases,
    collectionsByDb,
    loadingRoot,
    loadingDbs,
    expandedDbs,
    selectedNodeId,
    setSelectedNodeId,
    handleRefresh,
    handleExpandDb,
    searchQuery,
    setSearchQuery,
    trimmedQuery,
    lowerQuery,
    isFiltering,
    filteredDatabases,
  } = tree;

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

      {loadingRoot && databases.length === 0 && (
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
          role="status"
        >
          <Loader2 className="animate-spin" size={12} />
          <span>Loading databases...</span>
        </div>
      )}

      {!loadingRoot && databases.length === 0 && (
        <div className="px-3 py-2 text-xs italic text-muted-foreground">
          No databases visible to this connection
        </div>
      )}

      {!loadingRoot &&
        databases.length > 0 &&
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
            <DatabaseRow
              db={db}
              isExpanded={isExpanded}
              isLoading={isLoading}
              isSelected={isDbSelected}
              onToggle={() => {
                setSelectedNodeId(dbNodeId);
                handleExpandDb(db.name);
              }}
            />

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
                    return (
                      <CollectionRow
                        key={coll.name}
                        database={db.name}
                        collection={coll}
                        isSelected={selectedNodeId === collNodeId}
                        onSelect={() => setSelectedNodeId(collNodeId)}
                        onOpen={() => handleCollectionOpen(db.name, coll.name)}
                        onDoubleOpen={() =>
                          handleCollectionDoubleClick(db.name, coll.name)
                        }
                        onRequestDrop={() =>
                          drop.requestDrop(db.name, coll.name)
                        }
                      />
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      <DropCollectionDialog
        target={drop.dropDialog}
        isDropping={drop.isDropping}
        onConfirm={drop.confirmDrop}
        onCancel={drop.cancelDrop}
      />
    </div>
  );
}
