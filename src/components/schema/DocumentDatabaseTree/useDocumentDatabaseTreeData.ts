import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import {
  isMongoSystemDatabase,
  MONGO_SYSTEM_DATABASES,
  type CollectionInfo,
  type DatabaseInfo,
} from "@/types/document";

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
  rootError: string | null;
  collectionErrors: Record<string, string | undefined>;
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
  const databases = useDocumentCatalogStore((s) => s.databases[connectionId]);
  const collectionsByDb = useDocumentCatalogStore(
    (s) => s.collections[connectionId] ?? EMPTY_COLLECTIONS_BY_DB,
  );
  const loadDatabases = useDocumentCatalogStore((s) => s.loadDatabases);
  const loadCollections = useDocumentCatalogStore((s) => s.loadCollections);

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
  const [rootError, setRootError] = useState<string | null>(null);
  const [collectionErrors, setCollectionErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const autoLoadedRef = useRef<string | null>(null);

  const loadRoot = useCallback(async () => {
    setRootError(null);
    setLoadingRoot(true);
    try {
      setRootError(await loadDatabases(connectionId));
    } catch (error) {
      setRootError(String(error));
    } finally {
      setLoadingRoot(false);
    }
  }, [connectionId, loadDatabases]);

  useEffect(() => {
    const guardKey = `${connectionId}::${activeDb ?? ""}`;
    if (autoLoadedRef.current === guardKey) return;
    autoLoadedRef.current = guardKey;
    void loadRoot();
  }, [connectionId, activeDb, loadRoot]);

  const handleRefresh = useCallback(() => {
    void loadRoot();
  }, [loadRoot]);

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
        setCollectionErrors((prev) => ({ ...prev, [dbName]: undefined }));
        setLoadingDbs((prev) => new Set(prev).add(dbName));
        try {
          const error = await loadCollections(connectionId, dbName);
          setCollectionErrors((prev) => ({
            ...prev,
            [dbName]: error ?? undefined,
          }));
        } catch (error) {
          setCollectionErrors((prev) => ({ ...prev, [dbName]: String(error) }));
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

  // Sprint 346 — user DB 가 먼저 (알파벳), system DB (admin/config/local) 가
  // 끝. backend 의 list_database_names 가 자체 정렬을 보장하지 않아 자주
  // `admin` 이 맨 위에 뜨는데, 사용자가 평소 작업할 DB 가 묻혀버리는 UX
  // 회귀. 시각 구분 (italic + muted) 은 row 컴포넌트에서.
  const databaseList = useMemo(() => {
    const raw = databases ?? [];
    const userDbs: DatabaseInfo[] = [];
    const systemByName = new Map<string, DatabaseInfo>();
    for (const db of raw) {
      if (isMongoSystemDatabase(db.name)) systemByName.set(db.name, db);
      else userDbs.push(db);
    }
    userDbs.sort((a, b) => a.name.localeCompare(b.name));
    const systemDbs = MONGO_SYSTEM_DATABASES.flatMap((n) => {
      const found = systemByName.get(n);
      return found ? [found] : [];
    });
    return [...userDbs, ...systemDbs];
  }, [databases]);

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
    rootError,
    collectionErrors,
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
