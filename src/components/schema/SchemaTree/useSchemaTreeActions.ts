import { useCallback, useState } from "react";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useMruStore } from "@stores/mruStore";
import { useSchemaCache } from "@/hooks/useSchemaCache";
import { DEFAULT_EXPANDED, nodeIdToString, type CategoryKey } from "./treeRows";

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
}

export interface SchemaTreeActions {
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
  handleViewClick: (viewName: string, schemaName: string) => void;
  handleOpenViewStructure: (viewName: string, schemaName: string) => void;
  handleFunctionClick: (funcName: string, schemaName: string) => void;
  handleCreateTable: (schemaName: string) => void;
}

export function useSchemaTreeActions({
  connectionId,
}: UseSchemaTreeActionsArgs): SchemaTreeActions {
  const {
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,
    expandSchema: loadExpandedSchema,
  } = useSchemaCache(connectionId);

  const functions = useSchemaStore((s) => s.functions);
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  // Sprint 235 — collapsed dialog state. Each modal owns its own form
  // state internally; this hook only tracks "which row was right-
  // clicked" so the slot wrappers can mount the right modal.
  const [renameTableDialog, setRenameTableDialog] = useState<{
    schemaName: string;
    tableName: string;
  } | null>(null);
  const [dropTableDialog, setDropTableDialog] = useState<{
    schemaName: string;
    tableName: string;
  } | null>(null);
  const [tableSearch, setTableSearch] = useState<Record<string, string>>({});
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
      void loadExpandedSchema(schemaName);
    },
    [expandedSchemas, loadExpandedSchema],
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
  const handleTableClick = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab({
        title: `${schemaName}.${tableName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: tableName,
        subView: "records",
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
  );

  const handleTableDoubleClick = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab({
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
    },
    [addTab, markConnectionUsed, connectionId],
  );

  const handleOpenStructure = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab({
        title: `${schemaName}.${tableName}`,
        connectionId,
        type: "table",
        closable: true,
        schema: schemaName,
        table: tableName,
        subView: "structure",
      });
      markConnectionUsed(connectionId);
    },
    [addTab, markConnectionUsed, connectionId],
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
      addTab({
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
    [addTab, markConnectionUsed, connectionId],
  );

  const handleOpenViewStructure = useCallback(
    (viewName: string, schemaName: string) => {
      setSelectedNodeId(null);
      addTab({
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
    [addTab, markConnectionUsed, connectionId],
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
      addQueryTab(connectionId);
      markConnectionUsed(connectionId);
      const latestTabs = useTabStore.getState().tabs;
      const newTab = latestTabs[latestTabs.length - 1];
      if (newTab && newTab.type === "query") {
        const key = `${connectionId}:${schemaName}`;
        const funcs = functions[key] ?? [];
        const func = funcs.find((f) => f.name === funcName);
        if (func?.source) {
          updateQuerySql(newTab.id, func.source);
        }
      }
    },
    [connectionId, addQueryTab, markConnectionUsed, updateQuerySql, functions],
  );

  const handleCreateTable = useCallback((schemaName: string) => {
    setCreateTableDialog({ schemaName });
  }, []);

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
    [],
  );

  const isCategoryExpanded = useCallback(
    (schemaName: string, key: CategoryKey): boolean => {
      const expanded = expandedCategories[schemaName] ?? DEFAULT_EXPANDED;
      return expanded.has(key);
    },
    [expandedCategories],
  );

  return {
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
    handleViewClick,
    handleOpenViewStructure,
    handleFunctionClick,
    handleCreateTable,
  };
}
