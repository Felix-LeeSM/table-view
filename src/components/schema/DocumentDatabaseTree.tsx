import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database as DbIcon,
  FileText,
  Folder,
  FolderOpen,
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
        schema: dbName,
        table: collectionName,
        subView: "records",
        paradigm: "document",
      });
    },
    [addTab, connectionId],
  );

  const databaseList = databases ?? [];

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

      {databaseList.map((db) => {
        const isExpanded = expandedDbs.has(db.name);
        const isLoading = loadingDbs.has(db.name);
        const key = `${connectionId}:${db.name}`;
        const collections = collectionsByDb[key] ?? [];
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
              {isExpanded ? (
                <FolderOpen
                  size={13}
                  className="shrink-0 text-muted-foreground"
                />
              ) : (
                <Folder size={13} className="shrink-0 text-muted-foreground" />
              )}
              <DbIcon size={12} className="shrink-0 text-muted-foreground" />
              <span className="truncate">{db.name}</span>
              {isLoading && (
                <Loader2 size={10} className="ml-auto animate-spin" />
              )}
            </button>

            {isExpanded && (
              <div>
                {isLoading && collections.length === 0 ? (
                  <div className="px-8 py-1 text-xs text-muted-foreground">
                    Loading...
                  </div>
                ) : collections.length === 0 ? (
                  <div className="px-8 py-1 text-2xs italic text-muted-foreground">
                    No collections
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
                        onClick={() => setSelectedNodeId(collNodeId)}
                        onDoubleClick={() =>
                          handleCollectionOpen(db.name, coll.name)
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
