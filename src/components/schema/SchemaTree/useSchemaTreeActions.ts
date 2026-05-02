import { useCallback, useRef, useState, type RefObject } from "react";
import { toast } from "@/lib/toast";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useSchemaCache } from "@/hooks/useSchemaCache";
import { DEFAULT_EXPANDED, nodeIdToString, type CategoryKey } from "./treeRows";
import type { ConfirmDialogState, RenameDialogState } from "./dialogs";

/**
 * Sprint 199 — handlers + dialog state extracted from `SchemaTree.tsx`.
 *
 * 12 handler (drop / rename / open structure / open data / refresh schema /
 * function source 등) + ConfirmDialog / RenameDialog state + 관련 store
 * selector subscription 을 한 hook 으로 묶어 entry 컴포넌트가 단순 dispatch
 * 만 하도록.
 *
 * Sprint 196 (FB-5b) 의 store-coupling 정책 답습 — `useQueryHistoryStore.
 * getState()` 직접 호출 금지, selector subscription 으로 `addHistoryEntry`
 * 가져옴. handler 안에서 closure 로 호출.
 *
 * pre-split 와 동일한 동작:
 *   * `handleDropTable` 가 confirm dialog 를 열고 confirm 시 SQL synthesise
 *     + history entry 등재 + `dropTable` invoke + 실패 시 toast 노출.
 *   * `handleStartRename` / `handleConfirmRename` 가 RenameDialog flow 처리
 *     (정규식 검증 + 실패 시 toast).
 *   * `handleTableClick` / `handleTableDoubleClick` / `handleOpenStructure`
 *     / `handleViewClick` / `handleOpenViewStructure` / `handleFunctionClick`
 *     이 `addTab` / `addQueryTab` 으로 라우팅.
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
}

export function useSchemaTreeActions({
  connectionId,
}: UseSchemaTreeActionsArgs): SchemaTreeActions {
  // Sprint 191 (AC-191-02) — 데이터 레이어 (load / refresh / prefetch +
  // loading state) 는 useSchemaCache 가 담당. 컴포넌트는 트리 UI state
  // (expanded / selected / search / dialog) 와 사용자 액션 (drop /
  // rename / open) 만 보유.
  const {
    schemas,
    loadingSchemas,
    loadingTables,
    refreshConnection,
    refreshSchema,
    expandSchema: loadExpandedSchema,
  } = useSchemaCache(connectionId);

  // 트리 렌더링에 필요한 캐시 read-only selector. write 는 모두 hook
  // 또는 dropTable / renameTable 액션을 통해 일어난다.
  const functions = useSchemaStore((s) => s.functions);
  const dropTable = useSchemaStore((s) => s.dropTable);
  const renameTableAction = useSchemaStore((s) => s.renameTable);
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);

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
   * Sprint 136 (AC-S136-01) — single-click on a table row opens the table in
   * a *preview* tab. `addTab` already creates the new tab with
   * `isPreview: true` and swaps an existing same-connection preview slot
   * onto the new target, so opening another row reuses the same tab slot
   * (no tab accumulation). Clicking the same row again is idempotent
   * (AC-S136-04) because `addTab` early-returns when an exact-match tab
   * already exists.
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
    },
    [addTab, connectionId],
  );

  /**
   * Double-click on a table row opens the table as a persistent tab
   * directly via `addTab({ permanent: true })`. This replaces the old
   * two-step addTab+promoteTab pattern so the lifecycle is managed
   * entirely within the store.
   */
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
    },
    [addTab, connectionId],
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
    },
    [addTab, connectionId],
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
          // Sprint 196 (FB-5b) — DDL fire point. Synthesise a user-readable
          // SQL string for the history row (real DROP statement is generated
          // server-side by `tauri.dropTable`, not surfaced here).
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
              // Sprint 191 (AC-191-03) — surface drop failures via toast +
              // dev console instead of silent swallow. The dialog still
              // closes so the user isn't trapped, but they get a visible
              // signal that nothing was dropped.
              const detail = err instanceof Error ? err.message : String(err);
              toast.error(
                `Failed to drop ${schemaName}.${tableName}: ${detail}`,
              );
              if (import.meta.env.DEV) {
                console.error("[SchemaTree] dropTable:", err);
              }
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
        // Sprint 191 (AC-191-03) — see dropTable rationale.
        const detail = err instanceof Error ? err.message : String(err);
        toast.error(
          `Failed to rename ${renameDialog.schemaName}.${renameDialog.tableName}: ${detail}`,
        );
        if (import.meta.env.DEV) {
          console.error("[SchemaTree] renameTable:", err);
        }
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
    },
    [addTab, connectionId],
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
    },
    [addTab, connectionId],
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
    [connectionId, addQueryTab, updateQuerySql, functions],
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
  };
}
