import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  RefreshCw,
  Loader2,
  Code2,
  Database,
  FolderOpen,
  Eye,
  LayoutGrid,
  Columns3,
  Trash2,
  Pencil,
  X,
  Search,
} from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import { useConnectionStore } from "../stores/connectionStore";
import { useTabStore } from "../stores/tabStore";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./ui/dialog";
import type { TableInfo } from "../types/schema";

const EMPTY_SCHEMAS: never[] = [];

/** Category definitions for schema objects. */
const CATEGORIES = [
  { key: "tables", label: "Tables", Icon: LayoutGrid, emptyLabel: "No tables" },
  { key: "views", label: "Views", Icon: Eye, emptyLabel: "No views" },
  {
    key: "functions",
    label: "Functions",
    Icon: Code2,
    emptyLabel: "No functions",
  },
  {
    key: "procedures",
    label: "Procedures",
    Icon: Code2,
    emptyLabel: "No procedures",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/** Unique identifier for a selectable tree node. */
type NodeId =
  | { type: "schema"; schema: string }
  | { type: "category"; schema: string; category: CategoryKey }
  | { type: "table"; schema: string; table: string };

function nodeIdToString(id: NodeId): string {
  switch (id.type) {
    case "schema":
      return `schema:${id.schema}`;
    case "category":
      return `category:${id.schema}:${id.category}`;
    case "table":
      return `table:${id.schema}:${id.table}`;
  }
}

/** Default expanded categories for a newly-opened schema. */
const DEFAULT_EXPANDED = new Set<CategoryKey>(["tables"]);

/** Context menu target types. */
interface TableContextMenuTarget {
  kind: "table";
  tableName: string;
  schemaName: string;
  x: number;
  y: number;
}

interface SchemaContextMenuTarget {
  kind: "schema";
  schemaName: string;
  x: number;
  y: number;
}

type ContextMenuTarget =
  | TableContextMenuTarget
  | SchemaContextMenuTarget
  | null;

/** Confirmation dialog state. */
interface ConfirmDialog {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
  onConfirm: () => void;
}

/** Rename dialog state. */
interface RenameDialog {
  tableName: string;
  schemaName: string;
  initialValue: string;
}

interface SchemaTreeProps {
  connectionId: string;
}

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]) ?? EMPTY_SCHEMAS;
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const dropTable = useSchemaStore((s) => s.dropTable);
  const renameTableAction = useSchemaStore((s) => s.renameTable);
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const tables = useSchemaStore((s) => s.tables);
  const connectionName = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name,
  );

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
  const [contextMenuTarget, setContextMenuTarget] =
    useState<ContextMenuTarget>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(
    null,
  );
  const [renameDialog, setRenameDialog] = useState<RenameDialog | null>(null);
  const [renameInput, setRenameInput] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isOperating, setIsOperating] = useState(false);
  const autoLoadedRef = useRef<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [tableSearch, setTableSearch] = useState<Record<string, string>>({});

  // Auto-load schemas on mount or when connectionId changes
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener("refresh-schema", handler);
    return () => window.removeEventListener("refresh-schema", handler);
  }, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpandSchema = async (schemaName: string) => {
    const newExpanded = new Set(expandedSchemas);
    if (newExpanded.has(schemaName)) {
      newExpanded.delete(schemaName);
      setExpandedSchemas(newExpanded);
      return;
    }
    newExpanded.add(schemaName);
    setExpandedSchemas(newExpanded);

    const key = `${connectionId}:${schemaName}`;
    if (!tables[key]) {
      setLoadingTables((prev) => new Set(prev).add(schemaName));
      loadTables(connectionId, schemaName)
        .catch(() => {})
        .finally(() =>
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(schemaName);
            return next;
          }),
        );
    }
  };

  const handleRefresh = useCallback(() => {
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas]);

  const handleRefreshSchema = useCallback(
    (schemaName: string) => {
      const key = `${connectionId}:${schemaName}`;
      setLoadingTables((prev) => new Set(prev).add(schemaName));
      // Clear cached tables to force a reload
      useSchemaStore.setState((state) => {
        const newTables = { ...state.tables };
        delete newTables[key];
        return { tables: newTables };
      });
      loadTables(connectionId, schemaName)
        .catch(() => {})
        .finally(() =>
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(schemaName);
            return next;
          }),
        );
    },
    [connectionId, loadTables],
  );

  const handleTableClick = (tableName: string, schemaName: string) => {
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
  };

  const handleOpenStructure = (tableName: string, schemaName: string) => {
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
  };

  const handleDropTable = (tableName: string, schemaName: string) => {
    setConfirmDialog({
      title: "Drop Table",
      message: `Are you sure you want to drop "${schemaName}.${tableName}"? This action cannot be undone.`,
      confirmLabel: "Drop Table",
      danger: true,
      onConfirm: () => {
        setIsOperating(true);
        dropTable(connectionId, tableName, schemaName)
          .catch(() => {})
          .finally(() => {
            setIsOperating(false);
            setConfirmDialog(null);
          });
      },
    });
  };

  const handleStartRename = (tableName: string, schemaName: string) => {
    setRenameDialog({ tableName, schemaName, initialValue: tableName });
    setRenameInput(tableName);
    setRenameError(null);
  };

  const handleConfirmRename = () => {
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
      .catch(() => {})
      .finally(() => {
        setIsOperating(false);
        setRenameDialog(null);
      });
  };

  const toggleCategory = (schemaName: string, categoryKey: CategoryKey) => {
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
  };

  const isCategoryExpanded = (
    schemaName: string,
    key: CategoryKey,
  ): boolean => {
    const expanded = expandedCategories[schemaName] ?? DEFAULT_EXPANDED;
    return expanded.has(key);
  };

  // Build context menu items based on target
  const contextMenuItems: ContextMenuItem[] = contextMenuTarget
    ? contextMenuTarget.kind === "table"
      ? [
          {
            label: "Structure",
            icon: <Columns3 size={14} />,
            onClick: () =>
              handleOpenStructure(
                contextMenuTarget.tableName,
                contextMenuTarget.schemaName,
              ),
          },
          {
            label: "Data",
            icon: <Table2 size={14} />,
            onClick: () =>
              handleTableClick(
                contextMenuTarget.tableName,
                contextMenuTarget.schemaName,
              ),
          },
          {
            label: "Rename",
            icon: <Pencil size={14} />,
            onClick: () =>
              handleStartRename(
                contextMenuTarget.tableName,
                contextMenuTarget.schemaName,
              ),
          },
          {
            label: "Drop",
            icon: <Trash2 size={14} />,
            danger: true,
            onClick: () =>
              handleDropTable(
                contextMenuTarget.tableName,
                contextMenuTarget.schemaName,
              ),
          },
        ]
      : [
          {
            label: "Refresh",
            icon: <RefreshCw size={14} />,
            onClick: () => handleRefreshSchema(contextMenuTarget.schemaName),
          },
        ]
    : [];

  return (
    <div className="flex flex-col select-none">
      {/* Connection header with Database icon */}
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
        <Database size={13} className="shrink-0 text-primary" />
        <span className="truncate text-xs font-semibold text-foreground">
          {connectionName || connectionId}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
            onClick={() => addQueryTab(connectionId)}
            aria-label="New Query"
            title="New Query"
          >
            <Code2 size={12} />
          </button>
          <button
            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
            onClick={handleRefresh}
            disabled={loadingSchemas}
            aria-label="Refresh schemas"
          >
            {loadingSchemas ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
          </button>
        </div>
      </div>

      {/* "Schemas" header label */}
      <div className="px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Schemas
        </span>
      </div>

      {schemas.map((schema, schemaIndex) => {
        const isExpanded = expandedSchemas.has(schema.name);
        const tableKey = `${connectionId}:${schema.name}`;
        const schemaTables: TableInfo[] = tables[tableKey] ?? [];
        const isLoadingTables = loadingTables.has(schema.name);
        const schemaId = nodeIdToString({
          type: "schema",
          schema: schema.name,
        });
        const isSchemaSelected = selectedNodeId === schemaId;

        return (
          <div key={schema.name}>
            {/* Section separator between schemas */}
            {schemaIndex > 0 && (
              <div className="mx-3 my-0.5 border-t border-border" />
            )}

            {/* Schema row */}
            <div
              className={`flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted ${
                isSchemaSelected
                  ? "bg-muted text-foreground"
                  : "text-secondary-foreground"
              }`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${schema.name} schema`}
              onClick={() => {
                handleExpandSchema(schema.name);
                setSelectedNodeId(schemaId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleExpandSchema(schema.name);
                  setSelectedNodeId(schemaId);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenuTarget({
                  kind: "schema",
                  schemaName: schema.name,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0" />
              ) : (
                <ChevronRight size={12} className="shrink-0" />
              )}
              <FolderOpen
                size={13}
                className="shrink-0 text-muted-foreground"
              />
              <span className="truncate">{schema.name}</span>
              {isLoadingTables && (
                <Loader2 size={10} className="ml-auto animate-spin" />
              )}
            </div>

            {/* Category sections under expanded schema */}
            {isExpanded && (
              <div>
                {isLoadingTables && schemaTables.length === 0 ? (
                  <div className="px-8 py-1 text-xs text-muted-foreground">
                    Loading...
                  </div>
                ) : (
                  CATEGORIES.map((cat) => {
                    const catExpanded = isCategoryExpanded(
                      schema.name,
                      cat.key,
                    );
                    const categoryId = nodeIdToString({
                      type: "category",
                      schema: schema.name,
                      category: cat.key,
                    });
                    const isCatSelected = selectedNodeId === categoryId;

                    // For "tables" category, show actual tables. Others are empty.
                    const unfilteredItems: TableInfo[] =
                      cat.key === "tables" ? schemaTables : [];
                    const searchValue =
                      cat.key === "tables"
                        ? (tableSearch[schema.name] ?? "")
                        : "";
                    const searchLower = searchValue.toLowerCase();
                    const items: TableInfo[] =
                      cat.key === "tables"
                        ? searchLower
                          ? unfilteredItems.filter((t) =>
                              t.name.toLowerCase().includes(searchLower),
                            )
                          : unfilteredItems
                        : [];

                    return (
                      <div key={cat.key}>
                        {/* Category header */}
                        <div
                          className={`flex cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-6 text-[11px] font-medium hover:bg-muted ${
                            isCatSelected
                              ? "bg-muted text-foreground"
                              : "text-secondary-foreground"
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={catExpanded}
                          aria-label={`${cat.label} in ${schema.name}`}
                          onClick={() => toggleCategory(schema.name, cat.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleCategory(schema.name, cat.key);
                            }
                          }}
                        >
                          {catExpanded ? (
                            <ChevronDown size={11} className="shrink-0" />
                          ) : (
                            <ChevronRight size={11} className="shrink-0" />
                          )}
                          <cat.Icon
                            size={12}
                            className="shrink-0 text-muted-foreground"
                          />
                          <span>{cat.label}</span>
                          {cat.key === "tables" && schemaTables.length > 0 && (
                            <span className="ml-auto text-[10px] text-muted-foreground">
                              {schemaTables.length}
                            </span>
                          )}
                        </div>

                        {/* Category content */}
                        {catExpanded && (
                          <div>
                            {/* Search input for Tables category */}
                            {cat.key === "tables" &&
                              unfilteredItems.length > 0 && (
                                <div className="flex items-center gap-1 px-8 py-0.5">
                                  <Search
                                    size={11}
                                    className="shrink-0 text-muted-foreground"
                                  />
                                  <input
                                    type="text"
                                    className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
                                    placeholder="Filter tables..."
                                    value={searchValue}
                                    onChange={(e) =>
                                      setTableSearch((prev) => ({
                                        ...prev,
                                        [schema.name]: e.target.value,
                                      }))
                                    }
                                    aria-label={`Filter tables in ${schema.name}`}
                                  />
                                  {searchValue && (
                                    <button
                                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-secondary-foreground"
                                      onClick={() =>
                                        setTableSearch((prev) => {
                                          const next = { ...prev };
                                          delete next[schema.name];
                                          return next;
                                        })
                                      }
                                      aria-label={`Clear table filter in ${schema.name}`}
                                    >
                                      <X size={11} />
                                    </button>
                                  )}
                                </div>
                              )}
                            {items.length === 0 ? (
                              <div className="px-10 py-1 text-[11px] italic text-muted-foreground">
                                {cat.key === "tables" && searchValue
                                  ? "No matching tables"
                                  : cat.emptyLabel}
                              </div>
                            ) : (
                              items.map((item) => {
                                const tableId = nodeIdToString({
                                  type: "table",
                                  schema: schema.name,
                                  table: item.name,
                                });
                                const isTableSelected =
                                  selectedNodeId === tableId;

                                return (
                                  <div
                                    key={item.name}
                                    className={`flex cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-10 hover:bg-muted ${
                                      isTableSelected
                                        ? "bg-primary/10 text-primary"
                                        : "text-foreground"
                                    }`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${item.name} table`}
                                    onClick={() =>
                                      handleTableClick(item.name, schema.name)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleTableClick(
                                          item.name,
                                          schema.name,
                                        );
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      setContextMenuTarget({
                                        kind: "table",
                                        tableName: item.name,
                                        schemaName: schema.name,
                                        x: e.clientX,
                                        y: e.clientY,
                                      });
                                    }}
                                  >
                                    <Table2
                                      size={12}
                                      className="shrink-0 text-muted-foreground"
                                    />
                                    <span className="truncate text-xs">
                                      {item.name}
                                    </span>
                                    {item.row_count != null && (
                                      <span className="ml-auto text-[10px] text-muted-foreground">
                                        {item.row_count.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Context menu */}
      {contextMenuTarget && (
        <ContextMenu
          x={contextMenuTarget.x}
          y={contextMenuTarget.y}
          items={contextMenuItems}
          onClose={() => setContextMenuTarget(null)}
        />
      )}

      {/* Drop table confirmation dialog */}
      <Dialog
        open={!!confirmDialog}
        onOpenChange={(open) => !open && setConfirmDialog(null)}
      >
        <DialogContent
          className="w-80 bg-secondary p-4"
          showCloseButton={false}
        >
          <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
            <DialogHeader>
              <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
                {confirmDialog?.title}
              </DialogTitle>
              <DialogDescription className="mb-4 text-sm text-secondary-foreground">
                {confirmDialog?.message}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
                onClick={() => setConfirmDialog(null)}
                disabled={isOperating}
              >
                Cancel
              </button>
              <button
                className={`rounded px-3 py-1.5 text-sm font-medium text-white ${
                  confirmDialog?.danger
                    ? "bg-destructive hover:opacity-90"
                    : "bg-primary hover:opacity-90"
                } ${isOperating ? "cursor-not-allowed opacity-50" : ""}`}
                onClick={confirmDialog?.onConfirm}
                disabled={isOperating}
                aria-label={confirmDialog?.confirmLabel}
              >
                {isOperating ? "Dropping..." : confirmDialog?.confirmLabel}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename table dialog */}
      <Dialog
        open={!!renameDialog}
        onOpenChange={(open) => !open && setRenameDialog(null)}
      >
        <DialogContent
          className="w-80 bg-secondary p-4"
          showCloseButton={false}
        >
          <div className="rounded-lg border border-border bg-secondary p-4 shadow-xl">
            <DialogHeader>
              <DialogTitle className="mb-2 text-sm font-semibold text-foreground">
                Rename Table
              </DialogTitle>
              <DialogDescription className="mb-2 text-xs text-muted-foreground">
                {renameDialog?.schemaName}.{renameDialog?.tableName}
              </DialogDescription>
            </DialogHeader>
            <input
              ref={renameInputRef}
              type="text"
              className="mb-1 w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
              value={renameInput}
              onChange={(e) => {
                setRenameInput(e.target.value);
                setRenameError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleConfirmRename();
                }
              }}
              autoFocus
              aria-label="New table name"
            />
            {renameError && (
              <p className="mb-2 text-xs text-destructive">{renameError}</p>
            )}
            <DialogFooter className="mt-3 flex justify-end gap-2">
              <button
                className="rounded px-3 py-1.5 text-sm text-secondary-foreground hover:bg-muted"
                onClick={() => setRenameDialog(null)}
                disabled={isOperating}
              >
                Cancel
              </button>
              <button
                className={`rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 ${isOperating ? "cursor-not-allowed opacity-50" : ""}`}
                onClick={handleConfirmRename}
                disabled={isOperating}
                aria-label="Rename"
              >
                {isOperating ? "Renaming..." : "Rename"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
