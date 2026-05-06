import { useCallback, useRef, useState, type RefObject } from "react";
import { toast } from "@/lib/toast";
import { logger } from "@/lib/logger";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useMruStore } from "@stores/mruStore";
import { useSchemaCache } from "@/hooks/useSchemaCache";
import { useSchemaTableMutations } from "@/hooks/useSchemaTableMutations";
import { DEFAULT_EXPANDED, nodeIdToString, type CategoryKey } from "./treeRows";
import type { ConfirmDialogState, RenameDialogState } from "./dialogs";

/**
 * Handlers + dialog state for `SchemaTree`. Bundles the 12 action
 * handlers (drop / rename / open structure / open data / refresh schema /
 * function source / ...) with ConfirmDialog and RenameDialog state and
 * the relevant store subscriptions, so the entry component just
 * dispatches.
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

  // Dialog state
  confirmDialog: ConfirmDialogState | null;
  setConfirmDialog: (dialog: ConfirmDialogState | null) => void;
  renameDialog: RenameDialogState | null;
  setRenameDialog: (dialog: RenameDialogState | null) => void;
  renameInput: string;
  setRenameInput: (value: string) => void;
  renameError: string | null;
  setRenameError: (value: string | null) => void;
  isOperating: boolean;
  renameInputRef: RefObject<HTMLInputElement | null>;
  // Sprint 226 — create-table modal state. Schema name pre-fills the
  // read-only field; null state keeps the modal closed.
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
  handleDropTable: (tableName: string, schemaName: string) => void;
  handleStartRename: (tableName: string, schemaName: string) => void;
  handleConfirmRename: () => void;
  handleViewClick: (viewName: string, schemaName: string) => void;
  handleOpenViewStructure: (viewName: string, schemaName: string) => void;
  handleFunctionClick: (funcName: string, schemaName: string) => void;
  // Sprint 226 — opens `CreateTableDialog` pre-filled with the
  // right-clicked schema name. Commit-success refreshes the schema's
  // table list via `refreshSchema(schemaName)`.
  handleCreateTable: (schemaName: string) => void;
}

export function useSchemaTreeActions({
  connectionId,
}: UseSchemaTreeActionsArgs): SchemaTreeActions {
  // Data layer (load / refresh / prefetch + loading state) is delegated
  // to `useSchemaCache`; this hook only owns tree UI state and actions.
  const {
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,
    expandSchema: loadExpandedSchema,
  } = useSchemaCache(connectionId);

  // Read-only selectors for tree rendering. All writes go through the
  // hook itself or the dropTable / renameTable store actions below.
  const functions = useSchemaStore((s) => s.functions);
  // Sprint 223 (P10 step 2) — drop/rename now go through the use-case
  // hook that owns the reload-then-fallback orchestration. The store
  // actions themselves are thin Tauri-call wrappers; calling them
  // directly via `useSchemaStore` selector here would skip the
  // optimistic refresh.
  const { dropTable, renameTable: renameTableAction } =
    useSchemaTableMutations();
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  // MRU marking is the caller's responsibility; the 6 handlers below
  // pair their `addTab` / `addQueryTab` call with `markConnectionUsed`.
  const markConnectionUsed = useMruStore((s) => s.markConnectionUsed);

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(
    null,
  );
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(
    null,
  );
  const [renameInput, setRenameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [tableSearch, setTableSearch] = useState<Record<string, string>>({});
  // Sprint 226 — Create Table modal state. Modal is closed when null.
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

  /**
   * Single-click opens a *preview* tab. `addTab` defaults new tabs to
   * `isPreview: true` and swaps the same-connection preview slot onto
   * the new target, so opening another row reuses the slot rather than
   * piling up tabs. Clicking the same row again is idempotent because
   * `addTab` early-returns on exact-match.
   */
  const handleTableClick = useCallback(
    (tableName: string, schemaName: string) => {
      setSelectedNodeId(
        nodeIdToString({ type: "table", schema: schemaName, table: tableName }),
      );
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
      setSelectedNodeId(
        nodeIdToString({ type: "table", schema: schemaName, table: tableName }),
      );
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
      setSelectedNodeId(
        nodeIdToString({ type: "table", schema: schemaName, table: tableName }),
      );
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

  const handleDropTable = useCallback(
    (tableName: string, schemaName: string) => {
      setConfirmDialog({
        title: "Drop Table",
        message: `Are you sure you want to drop "${schemaName}.${tableName}"? This action cannot be undone.`,
        confirmLabel: "Drop Table",
        danger: true,
        onConfirm: () => {
          setIsOperating(true);
          // Synthesise a user-readable SQL string for the history row.
          // The real DROP runs server-side via `tauri.dropTable`.
          const startedAt = Date.now();
          const recordedSql = `DROP TABLE "${schemaName}"."${tableName}"`;
          dropTable(connectionId, tableName, schemaName)
            .then(() => {
              addHistoryEntry({
                sql: recordedSql,
                executedAt: startedAt,
                duration: Date.now() - startedAt,
                status: "success",
                connectionId,
                paradigm: "rdb",
                queryMode: "sql",
                source: "ddl-structure",
              });
            })
            .catch((err) => {
              // Surface failures via toast + dev console; dialog still
              // closes so the user isn't trapped.
              const detail = err instanceof Error ? err.message : String(err);
              toast.error(
                `Failed to drop ${schemaName}.${tableName}: ${detail}`,
              );
              logger.error("[SchemaTree] dropTable:", err);
              addHistoryEntry({
                sql: recordedSql,
                executedAt: startedAt,
                duration: Date.now() - startedAt,
                status: "error",
                connectionId,
                paradigm: "rdb",
                queryMode: "sql",
                source: "ddl-structure",
              });
            })
            .finally(() => {
              setIsOperating(false);
              setConfirmDialog(null);
            });
        },
      });
    },
    [connectionId, dropTable, addHistoryEntry],
  );

  const handleStartRename = useCallback(
    (tableName: string, schemaName: string) => {
      setRenameDialog({ tableName, schemaName, initialValue: tableName });
      setRenameInput(tableName);
      setRenameError(null);
    },
    [],
  );

  const handleConfirmRename = useCallback(() => {
    if (!renameDialog) return;
    const newName = renameInput.trim();

    if (!newName) {
      setRenameError("Table name must not be empty");
      return;
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(newName)) {
      setRenameError(
        "Table name must start with a letter or underscore and contain only alphanumeric characters and underscores",
      );
      return;
    }
    if (newName === renameDialog.tableName) {
      setRenameDialog(null);
      return;
    }

    setIsOperating(true);
    renameTableAction(
      connectionId,
      renameDialog.tableName,
      renameDialog.schemaName,
      newName,
    )
      .catch((err) => {
        const detail = err instanceof Error ? err.message : String(err);
        toast.error(
          `Failed to rename ${renameDialog.schemaName}.${renameDialog.tableName}: ${detail}`,
        );
        logger.error("[SchemaTree] renameTable:", err);
      })
      .finally(() => {
        setIsOperating(false);
        setRenameDialog(null);
      });
  }, [renameDialog, renameInput, connectionId, renameTableAction]);

  const handleViewClick = useCallback(
    (viewName: string, schemaName: string) => {
      setSelectedNodeId(
        nodeIdToString({ type: "view", schema: schemaName, view: viewName }),
      );
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
      setSelectedNodeId(
        nodeIdToString({ type: "view", schema: schemaName, view: viewName }),
      );
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
      // Load function source and put it in the newly created tab
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

  // Sprint 226 — schema-row context menu entry-point. Opens
  // `CreateTableDialog` pre-filled with the right-clicked schema name.
  // The modal owns the form state; commit-success calls `refreshSchema`
  // (passed through `dialogs.tsx`) so the new table appears in the tree
  // without manual reload.
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
    confirmDialog,
    setConfirmDialog,
    renameDialog,
    setRenameDialog,
    renameInput,
    setRenameInput,
    renameError,
    setRenameError,
    isOperating,
    renameInputRef,
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
    handleConfirmRename,
    handleViewClick,
    handleOpenViewStructure,
    handleFunctionClick,
    handleCreateTable,
  };
}
