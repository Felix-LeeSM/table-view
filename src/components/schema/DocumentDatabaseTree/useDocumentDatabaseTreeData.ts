import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentStore } from "@stores/documentStore";
import type { CollectionInfo, DatabaseInfo } from "@/types/document";

/**
 * Data + UI-state hook for `DocumentDatabaseTree`: fetches the database
 * list, owns expand/select/search state, fetches collections on first
 * expand, and auto-expands DBs whose collections match the search query
 * (remembering which it auto-added so clearing the query collapses only
 * those, not the user's manual expansions).
 */
export interface UseDocumentDatabaseTreeData {
  databases: DatabaseInfo[];
  /** Per-database collection lists for *this* connection. Sprint 265 lifted
   *  the documentStore cache from flat `"connId:db"` keys to nested
   *  `(connId, db)` maps, so the hook now projects `state.collections[connId]`
   *  — keyed by `dbName` only. */
  collectionsByDb: Record<string, CollectionInfo[] | undefined>;
  loadingRoot: boolean;
  loadingDbs: Set<string>;
  expandedDbs: Set<string>;
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string) => void;
  handleRefresh: () => void;
  handleExpandDb: (dbName: string) => Promise<void>;
  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  trimmedQuery: string;
  lowerQuery: string;
  isFiltering: boolean;
  filteredDatabases: DatabaseInfo[];
}

const EMPTY_COLLECTIONS_BY_DB: Record<string, CollectionInfo[] | undefined> =
  {};

export function useDocumentDatabaseTreeData(
  connectionId: string,
): UseDocumentDatabaseTreeData {
  const databases = useDocumentStore((s) => s.databases[connectionId]);
  const collectionsByDb = useDocumentStore(
    (s) => s.collections[connectionId] ?? EMPTY_COLLECTIONS_BY_DB,
  );
  const loadDatabases = useDocumentStore((s) => s.loadDatabases);
  const loadCollections = useDocumentStore((s) => s.loadCollections);

  // The DbSwitcher clears the documentStore cache on swap; the auto-load
  // guard below keys on `(connectionId, activeDb)` so the swap re-fetches
  // instead of short-circuiting. See lesson
  // 2026-05-05-document-tree-activedb-keyed-autoload.
  const activeDb = useConnectionStore((s) => {
    const status = s.activeStatuses[connectionId];
    return status?.type === "connected" ? (status.activeDb ?? null) : null;
  });

  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [loadingDbs, setLoadingDbs] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const autoLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    const guardKey = `${connectionId}::${activeDb ?? ""}`;
    if (autoLoadedRef.current === guardKey) return;
    autoLoadedRef.current = guardKey;
    setLoadingRoot(true);
    loadDatabases(connectionId).finally(() => setLoadingRoot(false));
  }, [connectionId, activeDb, loadDatabases]);

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
      if (!collectionsByDb[dbName]) {
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

  const databaseList = useMemo(() => databases ?? [], [databases]);

  // Client-side filter: a database matches when its own name matches OR
  // any of its already-loaded collections match (case-insensitive
  // substring). Typing never triggers a fetch.
  const trimmedQuery = searchQuery.trim();
  const lowerQuery = trimmedQuery.toLowerCase();
  const isFiltering = trimmedQuery.length > 0;

  const filteredDatabases = useMemo(() => {
    if (!isFiltering) return databaseList;
    return databaseList.filter((db) => {
      if (db.name.toLowerCase().includes(lowerQuery)) return true;
      const collections = collectionsByDb[db.name] ?? [];
      return collections.some((c) => c.name.toLowerCase().includes(lowerQuery));
    });
  }, [databaseList, isFiltering, lowerQuery, collectionsByDb]);

  // Track which DBs we auto-expanded so clearing the query restores the
  // user's manual expansion state (without collapsing what they opened
  // themselves).
  const autoExpandedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!isFiltering) {
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
      const collections = collectionsByDb[db.name] ?? [];
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
    // `expandedDbs` is intentionally omitted: re-running this effect after
    // the very expansion it just produced would loop. The next user
    // interaction re-reads the latest state on the following render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiltering, lowerQuery, databaseList, collectionsByDb]);

  const setSelectedNodeIdStable = useCallback(
    (id: string) => setSelectedNodeId(id),
    [],
  );

  return {
    databases: databaseList,
    collectionsByDb,
    loadingRoot,
    loadingDbs,
    expandedDbs,
    selectedNodeId,
    setSelectedNodeId: setSelectedNodeIdStable,
    handleRefresh,
    handleExpandDb,
    searchQuery,
    setSearchQuery,
    trimmedQuery,
    lowerQuery,
    isFiltering,
    filteredDatabases,
  };
}
