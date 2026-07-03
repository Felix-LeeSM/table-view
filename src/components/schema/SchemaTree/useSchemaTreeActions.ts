import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import {
  resolveActiveDb,
  useWorkspaceKeyForConnection,
  useWorkspaceStore,
  type WorkspaceKey,
} from "@stores/workspaceStore";
import { useMruStore } from "@stores/mruStore";
import {
  useTableActivityStore,
  tableActivityKey,
} from "@stores/tableActivityStore";
import { shouldEagerLoadSchemas, useSchemaCache } from "@/hooks/useSchemaCache";
import {
  useMigrationExport,
  type ExportInclude,
} from "@/hooks/useMigrationExport";
import { DEFAULT_EXPANDED, nodeIdToString, type CategoryKey } from "./treeRows";

const EMPTY_EXPANDED: readonly string[] = Object.freeze([]);

/**
 * Handlers + dialog state for `SchemaTree`. Sprint 235 collapses the
 * legacy `confirmDialog` / `renameDialog` / `renameInput` / `renameError`
 * / `isOperating` / `renameInputRef` slots into two simple state slots:
 * `renameTableDialog` and `dropTableDialog`. The 3 handlers
 * `handleDropTable` / `handleStartRename` / `handleConfirmRename`
 * collapse into 2 simple openers (`handleStartRename` + `handleStartDrop`)
 * — both just set the dialog state. The previously inline Safe Mode +
 * history-record + toast paths now live INSIDE the new
 * `RenameTableDialog` / `DropTableDialog` modals (which delegate to
 * `useDdlPreviewExecution` for the lifecycle).
 *
 * Stores are read via selector subscription, never `getState()`, so the
 * hook stays test-mockable.
 */

interface UseSchemaTreeActionsArgs {
  connectionId: string;
  autoLoadAuxiliaryCatalog?: boolean;
  autoLoadFileAnalyticsSources?: boolean;
  clearFileAnalyticsSourcesOnRefresh?: boolean;
}

export interface SchemaTreeActions {
  // Sprint 262 Slice B — derived `(connId, db)` for the connection this
  // hook is wired to. Exposed so callers (SchemaTree mount effects) can
  // depend on it without re-deriving the connectionStore selectors.
  // `null` when no activeDb is resolvable (focused conn isn't connected).
  workspaceKey: WorkspaceKey | null;

  // Selection state
  selectedNodeId: string | null;
  setSelectedNodeId: (id: string | null) => void;

  // Schema expansion state
  expandedSchemas: Set<string>;
  setExpandedSchemas: (
    update: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  expandedCategories: Record<string, Set<CategoryKey>>;
  isCategoryExpanded: (schemaName: string, key: CategoryKey) => boolean;
  toggleCategory: (schemaName: string, categoryKey: CategoryKey) => void;

  // Table search filter
  tableSearch: Record<string, string>;
  setTableSearch: (
    update:
      | Record<string, string>
      | ((prev: Record<string, string>) => Record<string, string>),
  ) => void;

  // #1217 — top-level global filter across the whole tree.
  globalFilter: string;
  setGlobalFilter: (value: string) => void;

  // Sprint 235 — modal slots. Each slot's null state keeps the modal
  // closed; setting `{ schemaName, tableName }` opens the matching
  // dialog. The modal's own commit-success path closes itself by
  // calling `setRenameTableDialog(null)` / `setDropTableDialog(null)`
  // through the slot wrapper.
  renameTableDialog: { schemaName: string; tableName: string } | null;
  setRenameTableDialog: (
    state: { schemaName: string; tableName: string } | null,
  ) => void;
  dropTableDialog: { schemaName: string; tableName: string } | null;
  setDropTableDialog: (
    state: { schemaName: string; tableName: string } | null,
  ) => void;
  // Sprint 226 — create-table modal state (unchanged).
  createTableDialog: { schemaName: string } | null;
  setCreateTableDialog: (state: { schemaName: string } | null) => void;

  // Schema cache (loading / refresh)
  schemas: ReturnType<typeof useSchemaCache>["schemas"];
  loadingSchemas: boolean;
  loadingTables: ReadonlySet<string>;
  refreshConnection: () => void;
  refreshSchema: (schemaName: string) => void;

  // Action handlers
  handleExpandSchema: (schemaName: string) => Promise<void>;
  handleRefresh: () => void;
  handleRefreshSchema: (schemaName: string) => void;
  handleTableClick: (tableName: string, schemaName: string) => void;
  handleTableDoubleClick: (tableName: string, schemaName: string) => void;
  handleOpenStructure: (tableName: string, schemaName: string) => void;
  // Sprint 235 — both handlers are simple openers. Behavioural diff
  // from the pre-Sprint 235 versions: the inline rename validation,
  // tauri call, history record, and toast paths now run inside the
  // modal (delegated to `useDdlPreviewExecution`).
  handleDropTable: (tableName: string, schemaName: string) => void;
  handleStartRename: (tableName: string, schemaName: string) => void;
  // #1218 — pin/unpin a table + current pin state (for the menu label).
  handleTogglePin: (tableName: string, schemaName: string) => void;
  isTablePinned: (tableName: string, schemaName: string) => boolean;
  handleViewClick: (viewName: string, schemaName: string) => void;
  handleOpenViewStructure: (viewName: string, schemaName: string) => void;
  handleFunctionClick: (funcName: string, schemaName: string) => void;
  handleCreateTable: (schemaName: string) => void;
  // Sprint 301 — schema / table 컨텍스트 메뉴 export 진입점. 헤더의
  // Download Popover 와 동일한 useMigrationExport 경로를 재사용.
  handleExportSchema: (schemaName: string, include: ExportInclude) => void;
  handleExportTable: (
    tableName: string,
    schemaName: string,
    include: ExportInclude,
  ) => void;
}

export function useSchemaTreeActions({
  connectionId,
  autoLoadAuxiliaryCatalog = false,
  autoLoadFileAnalyticsSources = false,
  clearFileAnalyticsSourcesOnRefresh = false,
}: UseSchemaTreeActionsArgs): SchemaTreeActions {
  // Sprint 262 Slice B — per-workspace sidebar state. Sprint 263 — schema
  // cache 도 같은 `(connId, db)` 키로 분리됐으므로, workspaceKey 해석은
  // useSchemaCache 호출 *이전* 으로 끈다. `workspaceKey` 가 null 인
  // transient 구간 (focused connection 의 activeDb 가 아직 미해석) 에는
  // db slot 으로 `""` 를 흘려보낸다 — useSchemaCache 의 auto-load 가 이
  // sentinel 을 보면 fetch 를 건너뛴다. activeDb 가 해석되면 effect 가
  // 재실행되며 정상 load 가 트리거된다.
  //
  // `workspaceKey` 는 ref 에 미러링한다. 그 결과 `setExpandedSchemas` /
  // `setSelectedNodeId` 가 key 변동에 영향받지 않는 **stable callback** 이
  // 된다 — SchemaTree 의 auto-expand 효과들이 deps 로 이걸 받기 때문에,
  // setter 가 key 마다 새 identity 를 가지면 (db1 → db2 → db1 라운드트립에
  // 효과가 재실행되며 collapse 가 매번 덮어써짐) AC-262-05 의 보존 조건이
  // 깨진다. ref 패턴이 그 경로를 차단한다.
  const workspaceKey = useWorkspaceKeyForConnection(connectionId);
  const workspaceKeyRef = useRef(workspaceKey);
  useEffect(() => {
    workspaceKeyRef.current = workspaceKey;
  }, [workspaceKey]);

  const {
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,
    expandSchema: loadExpandedSchema,
  } = useSchemaCache(connectionId, workspaceKey?.db ?? "", {
    autoLoadAuxiliaryCatalog,
    autoLoadFileAnalyticsSources,
    clearFileAnalyticsSourcesOnRefresh,
  });

  const functions = useSchemaStore((s) => s.functions);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const addQueryTab = useWorkspaceStore((s) => s.addQueryTab);
  const updateQuerySql = useWorkspaceStore((s) => s.updateQuerySql);
  const setExpandedStore = useWorkspaceStore((s) => s.setExpanded);
  const setSelectedNodeStore = useWorkspaceStore((s) => s.setSelectedNode);
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);
  // #1218 — table-level usage record + pin. `recordTableUsed` fires on the
  // same table-open handlers as `markConnectionUsed`; `entries` subscription
  // keeps `isTablePinned` reactive so the context-menu label flips live.
  const recordTableUsed = useTableActivityStore((s) => s.recordTableUsed);
  const togglePin = useTableActivityStore((s) => s.togglePin);
  const tableActivityEntries = useTableActivityStore((s) => s.entries);

  const expandedArray = useWorkspaceStore((s) =>
    workspaceKey
      ? (s.workspaces[workspaceKey.connId]?.[workspaceKey.db]?.sidebar
          .expanded ?? EMPTY_EXPANDED)
      : EMPTY_EXPANDED,
  );
  const expandedSchemas = useMemo(
    () => new Set(expandedArray),
    [expandedArray],
  );
  const setExpandedSchemas = useCallback(
    (update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const key = workspaceKeyRef.current;
      if (!key) return;
      let next: Set<string>;
      if (typeof update === "function") {
        const current =
          useWorkspaceStore.getState().workspaces[key.connId]?.[key.db]?.sidebar
            .expanded ?? [];
        next = update(new Set(current));
      } else {
        next = update;
      }
      setExpandedStore(key.connId, key.db, Array.from(next));
    },
    [setExpandedStore],
  );

  const selectedNodeId = useWorkspaceStore((s) =>
    workspaceKey
      ? (s.workspaces[workspaceKey.connId]?.[workspaceKey.db]?.sidebar
          .selectedNode ?? null)
      : null,
  );
  const setSelectedNodeId = useCallback(
    (id: string | null) => {
      const key = workspaceKeyRef.current;
      if (!key) return;
      setSelectedNodeStore(key.connId, key.db, id);
    },
    [setSelectedNodeStore],
  );

  // Sprint 262 Slice B — fresh-workspace seed. #1217 changed the seed from
  // "all schemas expanded" to "only the first schema expanded" (the product
  // rule for long collapsible lists). Two guards keep it non-destructive:
  //   - session-scoped ref: one seed per `(connId, db)` per component
  //     instance, so a user collapse isn't re-seeded mid-session (AC-262-05).
  //   - `expanded === null` check: `null` marks a genuinely never-seeded
  //     sidebar; an array — including a user-emptied `[]` — means "already
  //     seeded / user-set", so we never re-seed it. This is what lets a user
  //     collapse everything, restart, and keep it collapsed (the persisted
  //     `[]` rehydrates as an array, not `null`).
  const seededKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!workspaceKey) return;
    if (schemas.length === 0) return;
    const keyStr = `${workspaceKey.connId}:${workspaceKey.db}`;
    if (seededKeysRef.current.has(keyStr)) return;
    seededKeysRef.current.add(keyStr);
    // `undefined` (no cell yet) or `null` (fresh cell) → never seeded → seed.
    // A real array (even `[]`, a user who collapsed all) → respect it.
    const expanded =
      useWorkspaceStore.getState().workspaces[workspaceKey.connId]?.[
        workspaceKey.db
      ]?.sidebar.expanded;
    if (expanded != null) return;
    setExpandedStore(workspaceKey.connId, workspaceKey.db, [schemas[0]!.name]);
  }, [workspaceKey, schemas, setExpandedStore]);

  // #1219 — in the lazy path (wide catalog) the mount effect loads only the
  // schema list; expanded schemas must still show content. Reconcile by
  // loading each expanded schema — the first-schema seed above (fresh
  // workspace) and any persisted `SidebarState.expanded` (reconnect). Reuses
  // `loadExpandedSchema`, whose cache guards make already-loaded schemas a
  // no-op, so collapsed schemas stay unfetched (AC-1/AC-4). Skipped in eager
  // mode where the mount effect already loaded everything.
  useEffect(() => {
    if (shouldEagerLoadSchemas(schemas, autoLoadAuxiliaryCatalog)) {
      return;
    }
    for (const name of expandedSchemas) {
      void loadExpandedSchema(name);
    }
  }, [schemas, autoLoadAuxiliaryCatalog, expandedSchemas, loadExpandedSchema]);

  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});

  // Sprint 235 — collapsed dialog state. Each modal owns its own form
  // state internally; this hook only tracks "which row was right-
  // clicked" so the slot wrappers can mount the right modal.
  // Sprint 275 — trigger CRUD moved entirely to StructurePanel; the
  // sidebar no longer owns CreateTrigger / DropTrigger slots.
  const [renameTableDialog, setRenameTableDialog] = useState<{
    schemaName: string;
    tableName: string;
  } | null>(null);
  const [dropTableDialog, setDropTableDialog] = useState<{
    schemaName: string;
    tableName: string;
  } | null>(null);
  const [tableSearch, setTableSearch] = useState<Record<string, string>>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [createTableDialog, setCreateTableDialog] = useState<{
    schemaName: string;
  } | null>(null);

  const handleExpandSchema = useCallback(
    async (schemaName: string) => {
      const newExpanded = new Set(expandedSchemas);
      if (newExpanded.has(schemaName)) {
        newExpanded.delete(schemaName);
        setExpandedSchemas(newExpanded);
        return;
      }
      newExpanded.add(schemaName);
      setExpandedSchemas(newExpanded);
      // #1219 — in the lazy path the reconciliation effect (keyed on the
      // expanded set) fires this load when the set changes, so calling it
      // here too would double-fire the IPC before the cache populates. Eager
      // mode has no reconciliation effect, so load directly there.
      if (shouldEagerLoadSchemas(schemas, autoLoadAuxiliaryCatalog)) {
        void loadExpandedSchema(schemaName);
      }
    },
    [
      autoLoadAuxiliaryCatalog,
      expandedSchemas,
      loadExpandedSchema,
      schemas,
      setExpandedSchemas,
    ],
  );

  const handleRefresh = refreshConnection;
  const handleRefreshSchema = refreshSchema;

  // 2026-05-11 — for table/view clicks we *clear* selectedNodeId rather
  // than setting it to the clicked node. The sidebar item highlight is
  // driven from `activeTab.schema` + `activeTab.table` (see
  // `treeRows.ts` `isActive` / `rows.tsx`); leaving selectedNodeId set
  // produced a stale highlight that survived tab switches (the OR rule
  // kept the last-clicked table lit even after the user moved to a
  // different tab). Clearing also displaces any prior schema/category
  // selection so AC-SEL-03 still holds.
  // #1218 — record a table-level open (connectionId, db, schema?, table) for
  // the Pinned/Recent sections. `db` is the workspace's active db; `schema` is
  // the raw name the tree passes (a real schema for PG, the db name for MySQL,
  // "main" for SQLite) so the reopen path is byte-identical to a tree click.
  const recordTableActivity = useCallback(
    (tableName: string, schemaName: string) => {
      recordTableUsed({
        connectionId,
        db: workspaceKeyRef.current?.db ?? "",
        schema: schemaName,
        table: tableName,
      });
    },
    [recordTableUsed, connectionId],
  );

  const handleTableClick = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab(connectionId, {
        title: `${schemaName}.${tableName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: tableName,
        subView: "records",
      });
      markConnectionUsed(connectionId);
      recordTableActivity(tableName, schemaName);
    },
    [
      addTab,
      markConnectionUsed,
      recordTableActivity,
      connectionId,
      setSelectedNodeId,
    ],
  );

  const handleTableDoubleClick = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab(connectionId, {
        title: `${schemaName}.${tableName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: tableName,
        subView: "records",
        permanent: true,
      });
      markConnectionUsed(connectionId);
      recordTableActivity(tableName, schemaName);
    },
    [
      addTab,
      markConnectionUsed,
      recordTableActivity,
      connectionId,
      setSelectedNodeId,
    ],
  );

  const handleOpenStructure = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab(connectionId, {
        title: `${schemaName}.${tableName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: tableName,
        subView: "structure",
      });
      markConnectionUsed(connectionId);
      recordTableActivity(tableName, schemaName);
    },
    [
      addTab,
      markConnectionUsed,
      recordTableActivity,
      connectionId,
      setSelectedNodeId,
    ],
  );

  // #1218 — pin/unpin a table from the tree context menu. Same (connectionId,
  // db, schema?, table) tuple as the recent record.
  const handleTogglePin = useCallback(
    (tableName: string, schemaName: string) => {
      togglePin({
        connectionId,
        db: workspaceKeyRef.current?.db ?? "",
        schema: schemaName,
        table: tableName,
      });
    },
    [togglePin, connectionId],
  );

  const isTablePinned = useCallback(
    (tableName: string, schemaName: string): boolean => {
      const key = tableActivityKey({
        connectionId,
        db: workspaceKey?.db ?? "",
        schema: schemaName,
        table: tableName,
      });
      return tableActivityEntries.some(
        (e) => tableActivityKey(e) === key && e.pinnedAt != null,
      );
    },
    [tableActivityEntries, connectionId, workspaceKey],
  );

  // Sprint 235 — opener for the new DropTableDialog. The legacy version
  // built a `confirmDialog` state with an inline tauri.dropTable
  // closure; the Phase 27 modal owns the entire commit lifecycle.
  const handleDropTable = useCallback(
    (tableName: string, schemaName: string) => {
      setDropTableDialog({ schemaName, tableName });
    },
    [],
  );

  // Sprint 235 — opener for the new RenameTableDialog. Same shape as
  // handleDropTable.
  const handleStartRename = useCallback(
    (tableName: string, schemaName: string) => {
      setRenameTableDialog({ schemaName, tableName });
    },
    [],
  );

  const handleViewClick = useCallback(
    (viewName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab(connectionId, {
        title: `${schemaName}.${viewName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: viewName,
        subView: "records",
        objectKind: "view",
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId, setSelectedNodeId],
  );

  const handleOpenViewStructure = useCallback(
    (viewName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab(connectionId, {
        title: `${schemaName}.${viewName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: viewName,
        subView: "structure",
        objectKind: "view",
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId, setSelectedNodeId],
  );

  const handleFunctionClick = useCallback(
    (funcName: string, schemaName: string) => {
      setSelectedNodeId(
        nodeIdToString({
          type: "function",
          schema: schemaName,
          functionName: funcName,
        }),
      );
      const db = resolveActiveDb(connectionId);
      addQueryTab(connectionId, db);
      markConnectionUsed(connectionId);
      const ws = useWorkspaceStore.getState().workspaces[connectionId]?.[db];
      const newTab = ws?.tabs[ws.tabs.length - 1];
      if (newTab && newTab.type === "query") {
        const funcs = functions[connectionId]?.[db]?.[schemaName] ?? [];
        const func = funcs.find((f) => f.name === funcName);
        if (func?.source) {
          updateQuerySql(connectionId, db, newTab.id, func.source);
        }
      }
    },
    [
      connectionId,
      addQueryTab,
      markConnectionUsed,
      updateQuerySql,
      functions,
      setSelectedNodeId,
    ],
  );

  const handleCreateTable = useCallback((schemaName: string) => {
    setCreateTableDialog({ schemaName });
  }, []);

  // Sprint 301 — useMigrationExport 를 직접 import 해 schema / table
  // 컨텍스트 메뉴 진입점을 wire. 헤더 Download Popover 가 사용하는
  // hook 인스턴스와는 별개 — `isExporting` lock 도 분리되지만, 사용자
  // 흐름상 두 진입점에서 동시 export 가 일어날 시나리오는 없다.
  const { exportSchema, exportTable } = useMigrationExport();
  const handleExportSchema = useCallback(
    (schemaName: string, include: ExportInclude) => {
      const key = workspaceKeyRef.current;
      if (!key) return;
      void exportSchema(key.connId, key.db, schemaName, include);
    },
    [exportSchema],
  );
  const handleExportTable = useCallback(
    (tableName: string, schemaName: string, include: ExportInclude) => {
      const key = workspaceKeyRef.current;
      if (!key) return;
      void exportTable(key.connId, key.db, schemaName, tableName, include);
    },
    [exportTable],
  );

  const toggleCategory = useCallback(
    (schemaName: string, categoryKey: CategoryKey) => {
      setExpandedCategories((prev) => {
        const current = prev[schemaName] ?? new Set(DEFAULT_EXPANDED);
        const next = new Set(current);
        if (next.has(categoryKey)) {
          next.delete(categoryKey);
        } else {
          next.add(categoryKey);
        }
        return { ...prev, [schemaName]: next };
      });
      setSelectedNodeId(
        nodeIdToString({
          type: "category",
          schema: schemaName,
          category: categoryKey,
        }),
      );
    },
    [setSelectedNodeId],
  );

  const isCategoryExpanded = useCallback(
    (schemaName: string, key: CategoryKey): boolean => {
      const expanded = expandedCategories[schemaName] ?? DEFAULT_EXPANDED;
      return expanded.has(key);
    },
    [expandedCategories],
  );

  return {
    // Slice B — derived workspace identity for the wired connection.
    workspaceKey,

    // Selection
    selectedNodeId,
    setSelectedNodeId,

    // Expansion
    expandedSchemas,
    setExpandedSchemas,
    expandedCategories,
    isCategoryExpanded,
    toggleCategory,

    // Search
    tableSearch,
    setTableSearch,
    globalFilter,
    setGlobalFilter,

    // Dialog
    renameTableDialog,
    setRenameTableDialog,
    dropTableDialog,
    setDropTableDialog,
    createTableDialog,
    setCreateTableDialog,

    // Schema cache
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,

    // Handlers
    handleExpandSchema,
    handleRefresh,
    handleRefreshSchema,
    handleTableClick,
    handleTableDoubleClick,
    handleOpenStructure,
    handleDropTable,
    handleStartRename,
    handleTogglePin,
    isTablePinned,
    handleViewClick,
    handleOpenViewStructure,
    handleFunctionClick,
    handleCreateTable,
    handleExportSchema,
    handleExportTable,
  };
}
