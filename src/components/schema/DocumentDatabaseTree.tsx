import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@components/ui/button";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useMruStore } from "@stores/mruStore";
import { cn } from "@lib/utils";
import {
  useTreeRoving,
  type TreeRovingRow,
} from "@components/shared/tree/useTreeRoving";
import {
  TREE_ROW_HEIGHT_ESTIMATE,
  TREE_VIRTUALIZE_THRESHOLD,
} from "@components/shared/tree/virtualize";
import type { CollectionInfo, DatabaseInfo } from "@/types/document";
import { useDocumentDatabaseTreeData } from "./DocumentDatabaseTree/useDocumentDatabaseTreeData";
import { useDocumentDatabaseDrop } from "./DocumentDatabaseTree/useDocumentDatabaseDrop";
import { CollectionRow, DatabaseRow } from "./DocumentDatabaseTree/rows";
import { DropCollectionDialog } from "./DocumentDatabaseTree/dialogs";

interface DocumentDatabaseTreeProps {
  connectionId: string;
}

// #1445 — flat, ordered render/roving model for the two-level document tree.
// db + collection rows are focusable treeitems; the placeholder rows
// (error / loading / empty) render inline but aren't tab stops.
type DocTreeRow =
  | {
      kind: "db";
      db: DatabaseInfo;
      isExpanded: boolean;
      isLoading: boolean;
      dbIndex: number;
    }
  | { kind: "coll-error"; dbName: string; error: string }
  | { kind: "coll-loading"; dbName: string }
  | { kind: "coll-empty"; dbName: string; hasAll: boolean }
  | {
      kind: "coll";
      dbName: string;
      coll: CollectionInfo;
      collIndex: number;
      setSize: number;
    };

/**
 * Two-level tree for the document paradigm. Level 1: databases
 * (`list_mongo_databases`). Level 2: collections (fetched on-demand on
 * first expand).
 */
export default function DocumentDatabaseTree({
  connectionId,
}: DocumentDatabaseTreeProps) {
  const { t } = useTranslation("schema");
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  // MRU marking is the caller's responsibility — `addTab` no longer emits
  // it implicitly, so each tab-open path here pairs the call.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const tree = useDocumentDatabaseTreeData(connectionId);
  const drop = useDocumentDatabaseDrop(connectionId);

  const handleCollectionOpen = useCallback(
    (dbName: string, collectionName: string) => {
      addTab(connectionId, {
        type: "table",
        title: `${dbName}.${collectionName}`,
        connectionId,
        closable: true,
        // `database`/`collection` are the primary fields for new readers;
        // `schema`/`table` are written for backwards-compat with persisted
        // document tabs from before the paradigm split (`loadPersistedTabs`
        // migrates them).
        database: dbName,
        collection: collectionName,
        schema: dbName,
        table: collectionName,
        subView: "records",
        paradigm: "document",
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
  );

  // Sprint 330 (Slice DB-Scope.3) — sidebar 의 database row 우클릭으로
  // 클릭한 row 의 database 에 prefilled mongosh tab 을 spawn. TabDbChip
  // popover (Sprint 329) 가 가리키는 명시적 entry-point.
  const handleNewQueryHere = useCallback(
    (dbName: string) => {
      addQueryTab(connectionId, dbName, {
        paradigm: "document",
        database: dbName,
      });
      markConnectionUsed(connectionId);
    },
    [addQueryTab, markConnectionUsed, connectionId],
  );

  const handleCollectionDoubleClick = useCallback(
    (dbName: string, collectionName: string) => {
      addTab(connectionId, {
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
    rootError,
    collectionErrors,
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

  // Flatten the two-level tree into the render/roving model once: each visible
  // database plus, when expanded, the collections that survive the filter.
  const visibleTree = filteredDatabases.map((db) => {
    const isExpanded = expandedDbs.has(db.name);
    const isLoading = loadingDbs.has(db.name);
    const allCollections = collectionsByDb[db.name] ?? [];
    const collectionError = collectionErrors[db.name];
    // If the query matched the DB name, show every collection. If it only
    // matched some collection names, narrow the list to those.
    const dbNameMatches =
      !isFiltering || db.name.toLowerCase().includes(lowerQuery);
    const collections =
      isFiltering && !dbNameMatches
        ? allCollections.filter((c) =>
            c.name.toLowerCase().includes(lowerQuery),
          )
        : allCollections;
    return {
      db,
      isExpanded,
      isLoading,
      allCollections,
      collectionError,
      collections,
    };
  });

  // #1445 — flatten the two-level tree (db + collection + placeholder rows)
  // into a single ordered list so a database with thousands of collections
  // can be virtualized instead of mounting every row (which hung the tab).
  // Placeholder rows (error / loading / empty) are included so the flat
  // indices align 1:1 with the roving list a virtualized `scrollToIndex`
  // needs; only db + collection rows are focusable.
  const flatRows: DocTreeRow[] = [];
  visibleTree.forEach((entry, dbIndex) => {
    flatRows.push({
      kind: "db",
      db: entry.db,
      isExpanded: entry.isExpanded,
      isLoading: entry.isLoading,
      dbIndex,
    });
    if (!entry.isExpanded) return;
    if (entry.collectionError) {
      flatRows.push({
        kind: "coll-error",
        dbName: entry.db.name,
        error: entry.collectionError,
      });
    }
    if (
      !entry.collectionError &&
      entry.isLoading &&
      entry.allCollections.length === 0
    ) {
      flatRows.push({ kind: "coll-loading", dbName: entry.db.name });
    } else if (!entry.collectionError && entry.collections.length === 0) {
      flatRows.push({
        kind: "coll-empty",
        dbName: entry.db.name,
        hasAll: entry.allCollections.length > 0,
      });
    } else if (entry.collections.length > 0) {
      entry.collections.forEach((coll, collIndex) => {
        flatRows.push({
          kind: "coll",
          dbName: entry.db.name,
          coll,
          collIndex,
          setSize: entry.collections.length,
        });
      });
    }
  });

  const dbCount = visibleTree.length;

  // WAI-ARIA tree roving — one tab stop, arrow-key nav. ArrowRight/Left on a
  // database toggles it. Rows align with `flatRows` so a virtualized
  // `scrollToIndex` targets the right window.
  const treeRef = useRef<HTMLDivElement>(null);
  const rovingRows: TreeRovingRow[] = flatRows.map((row) => {
    if (row.kind === "db") {
      return {
        key: `db:${row.db.name}`,
        depth: 0,
        expanded: row.isExpanded,
        focusable: true,
      };
    }
    if (row.kind === "coll") {
      return {
        key: `coll:${row.dbName}:${row.coll.name}`,
        depth: 1,
        expanded: null,
        focusable: true,
      };
    }
    return {
      key: `${row.kind}:${row.dbName}`,
      depth: 1,
      expanded: null,
      focusable: false,
    };
  });

  // #1445 — hand off to the virtualizer past the threshold. The root
  // `role="tree"` div is the scroll element (mirrors SchemaTree); the header
  // (title + search + status) sits above the list inside the same scroll
  // container, so its height is fed back as `scrollMargin` to keep the list
  // tail from clipping.
  const shouldVirtualize = flatRows.length > TREE_VIRTUALIZE_THRESHOLD;
  const headerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? flatRows.length : 0,
    getScrollElement: () => treeRef.current,
    estimateSize: () => TREE_ROW_HEIGHT_ESTIMATE,
    overscan: 8,
    scrollMargin,
  });
  useLayoutEffect(() => {
    const list = listRef.current;
    const header = headerRef.current;
    if (!list || !header) return;
    const measure = () => setScrollMargin(list.offsetTop);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const roving = useTreeRoving(
    rovingRows,
    (key) => {
      // Only database rows expand/collapse; the key encodes the db name.
      if (key.startsWith("db:")) {
        const name = key.slice("db:".length);
        setSelectedNodeId(`db:${name}`);
        handleExpandDb(name);
      }
    },
    treeRef,
    shouldVirtualize
      ? (index) => rowVirtualizer.scrollToIndex(index)
      : undefined,
  );
  const activeKey = roving.focusKey ?? rovingRows[0]?.key ?? null;

  // Render one flat row (db / collection / placeholder). Shared by the eager
  // and virtualized branches so both emit identical row DOM.
  const renderFlatRow = (row: DocTreeRow) => {
    if (row.kind === "db") {
      const dbNodeId = `db:${row.db.name}`;
      return (
        <DatabaseRow
          db={row.db}
          isExpanded={row.isExpanded}
          isLoading={row.isLoading}
          isSelected={selectedNodeId === dbNodeId}
          onToggle={() => {
            setSelectedNodeId(dbNodeId);
            handleExpandDb(row.db.name);
          }}
          onNewQueryHere={() => handleNewQueryHere(row.db.name)}
          treeKey={dbNodeId}
          tabIndex={activeKey === dbNodeId ? 0 : -1}
          onFocus={() => roving.setFocusKey(dbNodeId)}
          posInSet={row.dbIndex + 1}
          setSize={dbCount}
        />
      );
    }
    if (row.kind === "coll-error") {
      return (
        <div
          className="mx-8 my-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-2xs text-destructive"
          role="alert"
        >
          {t("collectionMetadataUnavailable", { error: row.error })}
        </div>
      );
    }
    if (row.kind === "coll-loading") {
      return (
        <div className="px-8 py-1 text-xs text-muted-foreground">
          {t("loadingCollections")}
        </div>
      );
    }
    if (row.kind === "coll-empty") {
      return (
        <div className="px-8 py-1 text-2xs italic text-muted-foreground">
          {isFiltering && row.hasAll
            ? t("noMatchingCollections")
            : t("noCollections")}
        </div>
      );
    }
    const collNodeId = `coll:${row.dbName}:${row.coll.name}`;
    return (
      <CollectionRow
        database={row.dbName}
        collection={row.coll}
        isSelected={selectedNodeId === collNodeId}
        onSelect={() => setSelectedNodeId(collNodeId)}
        onOpen={() => handleCollectionOpen(row.dbName, row.coll.name)}
        onDoubleOpen={() =>
          handleCollectionDoubleClick(row.dbName, row.coll.name)
        }
        onRequestDrop={() => drop.requestDrop(row.dbName, row.coll.name)}
        treeKey={collNodeId}
        tabIndex={activeKey === collNodeId ? 0 : -1}
        onFocus={() => roving.setFocusKey(collNodeId)}
        posInSet={row.collIndex + 1}
        setSize={row.setSize}
      />
    );
  };

  const flatRowKey = (row: DocTreeRow): string =>
    row.kind === "db"
      ? `db:${row.db.name}`
      : row.kind === "coll"
        ? `coll:${row.dbName}:${row.coll.name}`
        : `${row.kind}:${row.dbName}`;

  return (
    <div
      ref={treeRef}
      className="relative flex flex-col select-none overflow-y-auto"
      role="tree"
      aria-label={t("databasesHeader")}
      onKeyDown={roving.onKeyDown}
    >
      {/* #1445 — header (title + search + root status) sits above the row
          list inside the scroll container; its height feeds the virtualizer
          `scrollMargin` so the windowed list's tail never clips. */}
      <div ref={headerRef}>
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
            {t("databasesHeader")}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleRefresh}
            disabled={loadingRoot}
            aria-label={t("refreshDatabasesAria")}
            title={t("refreshDatabasesTitle")}
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
            placeholder={t("filterDatabasesPlaceholder")}
            aria-label={t("filterDatabasesAria")}
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
            <span>{t("loadingDatabases")}</span>
          </div>
        )}

        {!loadingRoot && rootError && (
          <div
            className="mx-3 my-1 rounded border border-destructive/30 bg-destructive/5 px-2 py-1 text-2xs text-destructive"
            role="alert"
          >
            {t("databaseMetadataUnavailable", { error: rootError })}
          </div>
        )}

        {!loadingRoot && !rootError && databases.length === 0 && (
          <div className="px-3 py-2 text-xs italic text-muted-foreground">
            {t("noDatabasesVisible")}
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
              {t("noDatabasesMatch", { query: trimmedQuery })}
            </div>
          )}
      </div>

      <div ref={listRef}>
        {shouldVirtualize ? (
          <VirtualDbTreeRows
            flatRows={flatRows}
            virtualizer={rowVirtualizer}
            rowKey={flatRowKey}
          >
            {renderFlatRow}
          </VirtualDbTreeRows>
        ) : (
          flatRows.map((row) => (
            <div key={flatRowKey(row)}>{renderFlatRow(row)}</div>
          ))
        )}
      </div>

      <DropCollectionDialog
        target={drop.dropDialog}
        isDropping={drop.isDropping}
        onConfirm={drop.confirmDrop}
        onCancel={drop.cancelDrop}
      />
    </div>
  );
}

// #1445 — windowed row list with top/bottom `aria-hidden` spacers. Mirrors
// SchemaTree's `VirtualizedBranch`: `getVirtualItems()` reports offsets in
// scroll-element coordinates (shifted by the header `scrollMargin`), so the
// spacers subtract it back out to position rows within this list container.
function VirtualDbTreeRows({
  flatRows,
  virtualizer,
  rowKey,
  children,
}: {
  flatRows: DocTreeRow[];
  virtualizer: ReturnType<typeof useVirtualizer<HTMLDivElement, Element>>;
  rowKey: (row: DocTreeRow) => string;
  children: (row: DocTreeRow) => React.ReactNode;
}) {
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const scrollMargin = virtualizer.options.scrollMargin;
  const paddingTop = virtualItems.length
    ? virtualItems[0]!.start - scrollMargin
    : 0;
  const paddingBottom = virtualItems.length
    ? totalSize - (virtualItems[virtualItems.length - 1]!.end - scrollMargin)
    : 0;
  return (
    <div style={{ position: "relative" }}>
      {paddingTop > 0 && (
        <div aria-hidden="true" style={{ height: paddingTop }} />
      )}
      {virtualItems.map((virtualRow) => {
        const row = flatRows[virtualRow.index]!;
        return (
          <div
            key={rowKey(row)}
            data-index={virtualRow.index}
            ref={virtualizer.measureElement}
          >
            {children(row)}
          </div>
        );
      })}
      {paddingBottom > 0 && (
        <div aria-hidden="true" style={{ height: paddingBottom }} />
      )}
    </div>
  );
}
