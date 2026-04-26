import { useState, useEffect, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  RefreshCw,
  Loader2,
  Code2,
  FolderOpen,
  Folder,
  Eye,
  LayoutGrid,
  Columns3,
  Trash2,
  Pencil,
  X,
  Search,
  Terminal,
} from "lucide-react";
import { useSchemaStore } from "@stores/schemaStore";
import { useTabStore } from "@stores/tabStore";
import { useConnectionStore } from "@stores/connectionStore";
import { resolveRdbTreeShape, type RdbTreeShape } from "./treeShape";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
import { cn } from "@lib/utils";

const EMPTY_SCHEMAS: never[] = [];

/**
 * Sprint 137 (AC-S137-03) — DBMS-aware label for the row-count cell in the
 * sidebar. The number rendered next to a table name is an *estimate* on
 * every DBMS we currently support — pulling from `pg_class.reltuples` for
 * PostgreSQL and `information_schema.tables.TABLE_ROWS` for MySQL. SQLite
 * is the lone DBMS where the schema fetch reports an exact COUNT(*),
 * because SQLite has no estimate-only catalog and the file-local COUNT(*)
 * is fast enough at our scale. The same number was rendered without
 * a label prior to S137, which the 2026-04-27 user check found
 * misleading — users assumed it was an exact COUNT(*).
 *
 * Returns the user-facing description text. Both `aria-label` (screen
 * readers) and `title` (native hover tooltip) read from this string so
 * keyboard / mouse / a11y users get the same answer.
 */
function rowCountLabel(dbType: string | undefined): string {
  if (dbType === "postgresql") {
    return "Estimated row count from pg_class.reltuples";
  }
  if (dbType === "mysql") {
    return "Estimated row count from information_schema.tables";
  }
  if (dbType === "sqlite") {
    return "Exact row count via COUNT(*)";
  }
  // Unknown / unconfigured DBMS — keep the label honest by stating the
  // generic estimate semantics rather than silently dropping the cue.
  return "Estimated row count";
}

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
    Icon: Terminal,
    emptyLabel: "No procedures",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/** Unique identifier for a selectable tree node. */
type NodeId =
  | { type: "schema"; schema: string }
  | { type: "category"; schema: string; category: CategoryKey }
  | { type: "table"; schema: string; table: string }
  | { type: "view"; schema: string; view: string }
  | { type: "function"; schema: string; functionName: string };

function nodeIdToString(id: NodeId): string {
  switch (id.type) {
    case "schema":
      return `schema:${id.schema}`;
    case "category":
      return `category:${id.schema}:${id.category}`;
    case "table":
      return `table:${id.schema}:${id.table}`;
    case "view":
      return `view:${id.schema}:${id.view}`;
    case "function":
      return `function:${id.schema}:${id.functionName}`;
  }
}

/** Default expanded categories for a newly-opened schema. */
const DEFAULT_EXPANDED = new Set<CategoryKey>(["tables"]);

/**
 * Sprint-115 (#PERF-2, #TREE-4) — when the flattened "visible rows" list grows
 * past this threshold we hand `<tbody>` rendering off to `useVirtualizer` so
 * the DOM only carries a viewport-sized slice of rows. Below the threshold we
 * keep the eager nested layout, which means the 100 existing SchemaTree tests
 * (whose fixtures are all well under 200 rows) continue to assert against full
 * DOM output without virtualization spacers and with zero behavioral drift.
 */
const VIRTUALIZE_THRESHOLD = 200;

/**
 * Sprint-115 — estimated row height for the virtualizer. Schema, category, and
 * item rows all use compact text (`text-2xs` / `text-xs` with `py-0.5` / `py-1`)
 * which renders ~22-26px. We round up to 26 to keep overscan slightly
 * conservative; `react-virtual` measures actual DOM after first paint, so the
 * estimate only governs initial layout.
 */
const ROW_HEIGHT_ESTIMATE = 26;

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

/**
 * Sprint-115 — flat row representation produced by `getVisibleRows`. Each row
 * carries enough information for the virtualizer path to render the schema /
 * category / item cell variant without re-walking the original nested data.
 *
 * `kind === "schema-separator"` represents the thin divider line that the
 * eager path renders between sibling schemas; the virtualized path needs the
 * same hairline so the DOM stays visually consistent across the threshold.
 *
 * `kind === "loading"` and `kind === "empty"` and `kind === "search"` cover
 * the placeholder rows the eager path renders inside expanded categories so
 * the virtualizer can still hand the user the same affordances (filter input,
 * "No tables" message, loading spinner) when the dataset is huge.
 */
type VisibleRow =
  | { kind: "schema-separator"; key: string }
  | {
      kind: "schema";
      key: string;
      schemaName: string;
      isExpanded: boolean;
      isLoadingTables: boolean;
      isSelected: boolean;
    }
  | {
      kind: "loading";
      key: string;
      schemaName: string;
    }
  | {
      kind: "category";
      key: string;
      schemaName: string;
      category: (typeof CATEGORIES)[number];
      isExpanded: boolean;
      isSelected: boolean;
      itemCount: number;
    }
  | {
      kind: "search";
      key: string;
      schemaName: string;
      searchValue: string;
    }
  | {
      kind: "empty";
      key: string;
      schemaName: string;
      category: (typeof CATEGORIES)[number];
      hasActiveSearch: boolean;
    }
  | {
      kind: "item";
      key: string;
      schemaName: string;
      categoryKey: CategoryKey;
      item: TableInfo | ViewInfo | FunctionInfo;
      itemKind: "table" | "view" | "function";
      isSelected: boolean;
      isActive: boolean;
    };

interface BuildVisibleRowsArgs {
  schemas: ReadonlyArray<{ name: string }>;
  expandedSchemas: Set<string>;
  expandedCategories: Record<string, Set<CategoryKey>>;
  loadingTables: Set<string>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  connectionId: string;
  selectedNodeId: string | null;
  activeSchema: string | null;
  activeTable: string | null;
  tableSearch: Record<string, string>;
}

/**
 * Sprint-115 — flatten the currently-expanded portion of the schema tree into
 * a single list so `useVirtualizer` can window over it. The order here mirrors
 * the visual order of the eager nested render exactly: separator (between
 * sibling schemas) → schema row → categories → category rows → search input
 * → item rows / empty placeholder. Tests assert against this ordering when
 * the virtualized path is active.
 */
function getVisibleRows({
  schemas,
  expandedSchemas,
  expandedCategories,
  loadingTables,
  tables,
  views,
  functions,
  connectionId,
  selectedNodeId,
  activeSchema,
  activeTable,
  tableSearch,
}: BuildVisibleRowsArgs): VisibleRow[] {
  const rows: VisibleRow[] = [];

  schemas.forEach((schema, schemaIndex) => {
    if (schemaIndex > 0) {
      rows.push({ kind: "schema-separator", key: `sep:${schema.name}` });
    }

    const schemaId = nodeIdToString({ type: "schema", schema: schema.name });
    const isExpanded = expandedSchemas.has(schema.name);
    const isLoadingTables = loadingTables.has(schema.name);
    const tableKey = `${connectionId}:${schema.name}`;
    const schemaTables: TableInfo[] = tables[tableKey] ?? [];

    rows.push({
      kind: "schema",
      key: schemaId,
      schemaName: schema.name,
      isExpanded,
      isLoadingTables,
      isSelected: selectedNodeId === schemaId,
    });

    if (!isExpanded) return;

    if (isLoadingTables && schemaTables.length === 0) {
      rows.push({
        kind: "loading",
        key: `loading:${schema.name}`,
        schemaName: schema.name,
      });
      return;
    }

    for (const cat of CATEGORIES) {
      const expanded = expandedCategories[schema.name] ?? DEFAULT_EXPANDED;
      const catExpanded = expanded.has(cat.key);
      const categoryId = nodeIdToString({
        type: "category",
        schema: schema.name,
        category: cat.key,
      });
      const isCatSelected = selectedNodeId === categoryId;

      const schemaKey = `${connectionId}:${schema.name}`;
      const schemaViews: ViewInfo[] = views[schemaKey] ?? [];
      const schemaFunctions: FunctionInfo[] = functions[schemaKey] ?? [];

      const isTableCat = cat.key === "tables";
      const isViewCat = cat.key === "views";
      const isFunctionCat = cat.key === "functions";
      const isProcedureCat = cat.key === "procedures";

      const unfilteredItems: (TableInfo | ViewInfo | FunctionInfo)[] =
        isTableCat
          ? schemaTables
          : isViewCat
            ? schemaViews
            : isFunctionCat
              ? schemaFunctions.filter(
                  (f) =>
                    f.kind === "function" ||
                    f.kind === "aggregate" ||
                    f.kind === "window",
                )
              : isProcedureCat
                ? schemaFunctions.filter((f) => f.kind === "procedure")
                : [];
      const searchValue = isTableCat ? (tableSearch[schema.name] ?? "") : "";
      const searchLower = searchValue.toLowerCase();
      const items: (TableInfo | ViewInfo | FunctionInfo)[] = isTableCat
        ? searchLower
          ? unfilteredItems.filter((t) =>
              t.name.toLowerCase().includes(searchLower),
            )
          : unfilteredItems
        : unfilteredItems;

      rows.push({
        kind: "category",
        key: categoryId,
        schemaName: schema.name,
        category: cat,
        isExpanded: catExpanded,
        isSelected: isCatSelected,
        itemCount: items.length,
      });

      if (!catExpanded) continue;

      if (isTableCat && unfilteredItems.length > 0) {
        rows.push({
          kind: "search",
          key: `search:${schema.name}`,
          schemaName: schema.name,
          searchValue,
        });
      }

      if (items.length === 0) {
        rows.push({
          kind: "empty",
          key: `empty:${schema.name}:${cat.key}`,
          schemaName: schema.name,
          category: cat,
          hasActiveSearch: isTableCat && !!searchValue,
        });
        continue;
      }

      for (const item of items) {
        const itemKind: "table" | "view" | "function" = isTableCat
          ? "table"
          : isViewCat
            ? "view"
            : "function";
        const itemId =
          itemKind === "table"
            ? nodeIdToString({
                type: "table",
                schema: schema.name,
                table: item.name,
              })
            : itemKind === "view"
              ? nodeIdToString({
                  type: "view",
                  schema: schema.name,
                  view: item.name,
                })
              : nodeIdToString({
                  type: "function",
                  schema: schema.name,
                  functionName: item.name,
                });
        rows.push({
          kind: "item",
          key: `${cat.key}:${schema.name}:${item.name}`,
          schemaName: schema.name,
          categoryKey: cat.key,
          item,
          itemKind,
          isSelected: selectedNodeId === itemId,
          isActive:
            itemKind === "table" &&
            activeSchema === schema.name &&
            activeTable === item.name,
        });
      }
    }
  });

  return rows;
}

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]) ?? EMPTY_SCHEMAS;
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const prefetchSchemaColumns = useSchemaStore((s) => s.prefetchSchemaColumns);
  const loadViews = useSchemaStore((s) => s.loadViews);
  const loadFunctions = useSchemaStore((s) => s.loadFunctions);
  const dropTable = useSchemaStore((s) => s.dropTable);
  const renameTableAction = useSchemaStore((s) => s.renameTable);
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const connectionName = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.name,
  );
  // Sprint 135 — DBMS-shape-aware tree depth. Driven off `db_type` because
  // `paradigm` is always `"rdb"` for the three relational DBMSes we
  // currently ship (PG / MySQL / SQLite); the shape difference is *within*
  // the rdb paradigm. Defaults to `"with-schema"` (PG) when the connection
  // hasn't loaded yet so the initial paint matches the most explicit shape.
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.db_type,
  );
  const treeShape: RdbTreeShape = dbType
    ? resolveRdbTreeShape(dbType)
    : "with-schema";
  const updateQuerySql = useTabStore((s) => s.updateQuerySql);
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const functions = useSchemaStore((s) => s.functions);
  // Track active tab for highlight & auto-expand
  const activeTab = useTabStore((s) => {
    const tabId = s.activeTabId;
    return tabId ? s.tabs.find((t) => t.id === tabId) : null;
  });
  const activeSchema = activeTab?.type === "table" ? activeTab.schema : null;
  const activeTable = activeTab?.type === "table" ? activeTab.table : null;

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
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

  // Auto-load schemas on mount, then prefetch tables + columns for autocomplete
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .then(() => {
        const state = useSchemaStore.getState();
        const schemaList = state.schemas[connectionId] ?? [];
        for (const s of schemaList) {
          if (!state.tables[`${connectionId}:${s.name}`]) {
            loadTables(connectionId, s.name).catch(() => {});
          }
          prefetchSchemaColumns(connectionId, s.name);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas, loadTables, prefetchSchemaColumns]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener("refresh-schema", handler);
    return () => window.removeEventListener("refresh-schema", handler);
  }, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-expand schema when active tab changes to a table in that schema
  useEffect(() => {
    if (activeSchema) {
      setExpandedSchemas((prev) => {
        if (prev.has(activeSchema)) return prev;
        const next = new Set(prev);
        next.add(activeSchema);
        return next;
      });
    }
  }, [activeSchema]);

  // Sprint 135 — for `no-schema` (MySQL) and `flat` (SQLite) shapes the
  // schema row is hidden, but every backend-returned schema must still
  // be expanded behind the scenes so `loadTables` fires and the table
  // list appears under the sidebar root. We keep the existing
  // expandedSchemas state so the visible-rows / virtualized paths stay
  // unaware of the shape difference; the render branch below just skips
  // the schema button for these shapes.
  useEffect(() => {
    if (treeShape === "with-schema") return;
    if (schemas.length === 0) return;
    setExpandedSchemas((prev) => {
      let mutated = false;
      const next = new Set(prev);
      for (const s of schemas) {
        if (!next.has(s.name)) {
          next.add(s.name);
          mutated = true;
        }
      }
      return mutated ? next : prev;
    });
  }, [treeShape, schemas]);

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
    // Also load views and functions for this schema
    if (!views[key]) {
      loadViews(connectionId, schemaName).catch(() => {});
    }
    if (!functions[key]) {
      loadFunctions(connectionId, schemaName).catch(() => {});
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
      // Clear cached tables, views, functions to force a reload
      useSchemaStore.setState((state) => {
        const newTables = { ...state.tables };
        delete newTables[key];
        const newViews = { ...state.views };
        delete newViews[key];
        const newFunctions = { ...state.functions };
        delete newFunctions[key];
        return { tables: newTables, views: newViews, functions: newFunctions };
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
      loadViews(connectionId, schemaName).catch(() => {});
      loadFunctions(connectionId, schemaName).catch(() => {});
    },
    [connectionId, loadTables, loadViews, loadFunctions],
  );

  /**
   * Sprint 136 (AC-S136-01) — single-click on a table row opens the table in
   * a *preview* tab. `addTab` already creates the new tab with
   * `isPreview: true` and swaps an existing same-connection preview slot
   * onto the new target, so opening another row reuses the same tab slot
   * (no tab accumulation). Clicking the same row again is idempotent
   * (AC-S136-04) because `addTab` early-returns when an exact-match tab
   * already exists.
   */
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

  /**
   * Sprint 136 (AC-S136-02) — double-click on a table row promotes the tab
   * to a persistent (`isPreview: false`) tab. We open / swap onto the target
   * row first via the same `handleTableClick` path, then read back the active
   * tab id and call `promoteTab` so the user can keep the tab around even if
   * they click another row afterwards.
   */
  const handleTableDoubleClick = (tableName: string, schemaName: string) => {
    handleTableClick(tableName, schemaName);
    const activeTabId = useTabStore.getState().activeTabId;
    if (activeTabId) {
      useTabStore.getState().promoteTab(activeTabId);
    }
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

  const handleViewClick = (viewName: string, schemaName: string) => {
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
  };

  const handleOpenViewStructure = (viewName: string, schemaName: string) => {
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
  };

  const handleFunctionClick = (funcName: string, schemaName: string) => {
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

  // ──────────────────────────────────────────────────────────────────────
  // Sprint-115 — virtualization plumbing.
  //
  // We compute the flat visible-rows list unconditionally (it's just an
  // array walk over already-derived state) so the threshold check is a
  // single comparison and so the virtualized branch can index into the
  // same data the eager branch reads. The eager branch keeps its existing
  // nested JSX so the 100 baseline tests continue to assert against the
  // same DOM tree they were written against.
  // ──────────────────────────────────────────────────────────────────────
  const visibleRows = getVisibleRows({
    schemas,
    expandedSchemas,
    expandedCategories,
    loadingTables,
    tables,
    views,
    functions,
    connectionId,
    selectedNodeId,
    activeSchema: activeSchema ?? null,
    activeTable: activeTable ?? null,
    tableSearch,
  });

  // Sprint 135 — only the `with-schema` shape can fan out far enough to
  // need virtualization (PG: schemas × categories × items). MySQL/SQLite
  // shapes cap at table count which is bounded by the user's database
  // contents and rarely crosses the threshold; gating the virtualizer
  // keeps the simpler shapes on the eager path so the new render
  // branches above stay the only render branches.
  const shouldVirtualize =
    treeShape === "with-schema" && visibleRows.length > VIRTUALIZE_THRESHOLD;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Hooks must run unconditionally; when virtualization is off the count is 0
  // so the virtualizer holds no rows and does no measurement work.
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? visibleRows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 8,
  });

  // ──────────────────────────────────────────────────────────────────────
  // Sprint-115 — row render helpers shared by the eager + virtualized
  // paths. Each helper returns the same JSX the inline render previously
  // produced, so a row rendered through the virtualizer is byte-for-byte
  // identical to one rendered through the nested path. This keeps F2
  // rename, ContextMenu, search filter, and aria-* contracts intact
  // across the threshold.
  // ──────────────────────────────────────────────────────────────────────

  const renderSchemaRow = (row: Extract<VisibleRow, { kind: "schema" }>) => {
    const schemaId = row.key;
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={`flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted ${
              row.isSelected
                ? "bg-muted text-foreground"
                : "text-secondary-foreground"
            }`}
            aria-expanded={row.isExpanded}
            aria-label={`${row.schemaName} schema`}
            onClick={() => {
              handleExpandSchema(row.schemaName);
              setSelectedNodeId(schemaId);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleExpandSchema(row.schemaName);
                setSelectedNodeId(schemaId);
              }
            }}
          >
            {row.isExpanded ? (
              <ChevronDown size={12} className="shrink-0" />
            ) : (
              <ChevronRight size={12} className="shrink-0" />
            )}
            {row.isExpanded ? (
              <FolderOpen
                size={13}
                className="shrink-0 text-muted-foreground"
              />
            ) : (
              <Folder size={13} className="shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{row.schemaName}</span>
            {row.isLoadingTables && (
              <Loader2 size={10} className="ml-auto animate-spin" />
            )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => handleRefreshSchema(row.schemaName)}>
            <RefreshCw size={14} />
            Refresh
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderCategoryRow = (
    row: Extract<VisibleRow, { kind: "category" }>,
  ) => {
    const cat = row.category;
    return (
      <button
        type="button"
        className={`flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-6 text-2xs font-medium hover:bg-muted ${
          row.isSelected
            ? "bg-muted text-foreground"
            : "text-secondary-foreground"
        }`}
        aria-expanded={row.isExpanded}
        aria-label={`${cat.label} in ${row.schemaName}`}
        onClick={() => toggleCategory(row.schemaName, cat.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleCategory(row.schemaName, cat.key);
          }
        }}
      >
        {row.isExpanded ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronRight size={11} className="shrink-0" />
        )}
        <cat.Icon size={12} className="shrink-0 text-muted-foreground" />
        <span>{cat.label}</span>
        {row.itemCount > 0 && (
          <span className="ml-auto text-3xs text-muted-foreground">
            {row.itemCount}
          </span>
        )}
      </button>
    );
  };

  const renderSearchRow = (row: Extract<VisibleRow, { kind: "search" }>) => (
    <div className="flex items-center gap-1 px-8 py-0.5">
      <Search size={11} className="shrink-0 text-muted-foreground" />
      <input
        type="text"
        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        placeholder="Filter tables..."
        value={row.searchValue}
        onChange={(e) =>
          setTableSearch((prev) => ({
            ...prev,
            [row.schemaName]: e.target.value,
          }))
        }
        aria-label={`Filter tables in ${row.schemaName}`}
      />
      {row.searchValue && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() =>
            setTableSearch((prev) => {
              const next = { ...prev };
              delete next[row.schemaName];
              return next;
            })
          }
          aria-label={`Clear table filter in ${row.schemaName}`}
        >
          <X />
        </Button>
      )}
    </div>
  );

  const renderEmptyRow = (row: Extract<VisibleRow, { kind: "empty" }>) => (
    <div className="px-10 py-1 text-2xs italic text-muted-foreground">
      {row.category.key === "tables" && row.hasActiveSearch
        ? "No matching tables"
        : row.category.emptyLabel}
    </div>
  );

  const renderItemRow = (row: Extract<VisibleRow, { kind: "item" }>) => {
    const item = row.item;
    const isTableItem = row.itemKind === "table";
    const isView = row.itemKind === "view";
    const isFunc = row.itemKind === "function";

    const handleClick = () => {
      if (isView) {
        handleViewClick(item.name, row.schemaName);
      } else if (isFunc) {
        handleFunctionClick(item.name, row.schemaName);
      } else {
        handleTableClick(item.name, row.schemaName);
      }
    };

    // Sprint 136 — double-click promotes the preview tab to a persistent
    // tab (AC-S136-02). Only meaningful for table rows; views/functions
    // either spawn dedicated tabs (views) or query tabs (functions) which
    // do not participate in the table-preview slot.
    const handleDoubleClick = () => {
      if (isTableItem) {
        handleTableDoubleClick(item.name, row.schemaName);
      }
    };

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-10 hover:bg-muted",
              row.isSelected || row.isActive
                ? "bg-primary/10 text-primary font-semibold"
                : "text-foreground",
            )}
            aria-label={`${item.name} ${
              isView ? "view" : isFunc ? "function" : "table"
            }`}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleClick();
              } else if (e.key === "F2" && isTableItem) {
                e.preventDefault();
                handleStartRename(item.name, row.schemaName);
              }
            }}
          >
            {isView ? (
              <Eye size={12} className="shrink-0 text-muted-foreground" />
            ) : isFunc ? (
              <Code2 size={12} className="shrink-0 text-muted-foreground" />
            ) : (
              <Table2 size={12} className="shrink-0 text-muted-foreground" />
            )}
            <span className="truncate text-xs">{item.name}</span>
            {isTableItem &&
              "row_count" in item &&
              (item as TableInfo).row_count != null && (
                // Sprint 137 (AC-S137-03) — DBMS-aware tooltip + aria-label
                // so the user can tell whether the number is an estimate
                // (PG/MySQL) or an exact count (SQLite). `data-row-count`
                // is a stable hook for tests independent of icon/label
                // wrapping changes.
                <span
                  className="ml-auto text-3xs text-muted-foreground"
                  data-row-count="true"
                  aria-label={rowCountLabel(dbType)}
                  title={rowCountLabel(dbType)}
                >
                  {(item as TableInfo).row_count!.toLocaleString()}
                </span>
              )}
            {isFunc &&
              "arguments" in item &&
              (item as FunctionInfo).arguments && (
                <span className="ml-auto truncate text-3xs text-muted-foreground">
                  {(item as FunctionInfo).arguments}
                </span>
              )}
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isTableItem ? (
            <>
              <ContextMenuItem
                onClick={() => handleOpenStructure(item.name, row.schemaName)}
              >
                <Columns3 size={14} /> Structure
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => handleTableClick(item.name, row.schemaName)}
              >
                <Table2 size={14} /> Data
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => handleStartRename(item.name, row.schemaName)}
              >
                <Pencil size={14} /> Rename
              </ContextMenuItem>
              <ContextMenuItem
                danger
                onClick={() => handleDropTable(item.name, row.schemaName)}
              >
                <Trash2 size={14} /> Drop
              </ContextMenuItem>
            </>
          ) : isView ? (
            <>
              <ContextMenuItem
                onClick={() =>
                  handleOpenViewStructure(item.name, row.schemaName)
                }
              >
                <Columns3 size={14} /> Structure
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => handleViewClick(item.name, row.schemaName)}
              >
                <Table2 size={14} /> Data
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem
              onClick={() => handleFunctionClick(item.name, row.schemaName)}
            >
              <Code2 size={14} /> View Source
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const renderVisibleRow = (row: VisibleRow): React.ReactNode => {
    switch (row.kind) {
      case "schema-separator":
        return <div className="mx-3 my-0.5 border-t border-border" />;
      case "schema":
        return renderSchemaRow(row);
      case "loading":
        return (
          <div className="px-8 py-1 text-xs text-muted-foreground">
            Loading...
          </div>
        );
      case "category":
        return renderCategoryRow(row);
      case "search":
        return renderSearchRow(row);
      case "empty":
        return renderEmptyRow(row);
      case "item":
        return renderItemRow(row);
    }
  };

  // ──────────────────────────────────────────────────────────────────────
  // Body — eager nested layout vs. virtualized flat layout. The threshold
  // is `VIRTUALIZE_THRESHOLD` visible rows; below it the existing nested
  // JSX runs unchanged so the 100 baseline tests keep passing without
  // adjustment, above it `useVirtualizer` windows the flat list and we
  // render only the rows currently in the viewport.
  // ──────────────────────────────────────────────────────────────────────

  return (
    <div
      ref={scrollContainerRef}
      className="flex flex-col select-none overflow-y-auto"
    >
      {/* sr-only connection name for accessibility */}
      <span className="sr-only">{connectionName || connectionId}</span>

      {/* "Schemas" header label + refresh button */}
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-3xs font-medium uppercase tracking-wider text-muted-foreground">
          Schemas
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleRefresh}
          disabled={loadingSchemas}
          aria-label="Refresh schemas"
          title="Refresh schemas"
        >
          {loadingSchemas ? (
            <Loader2 className="animate-spin" size={12} />
          ) : (
            <RefreshCw size={12} />
          )}
        </Button>
      </div>

      {shouldVirtualize
        ? (() => {
            // Sprint-115 — virtualized branch. The virtualizer reports
            // a total scroll height (`getTotalSize()`) and a window of
            // visible items; we pad before/after with two `aria-hidden`
            // spacer divs so the inner content preserves the full scroll
            // height while only the windowed rows live in the DOM.
            const virtualItems = rowVirtualizer.getVirtualItems();
            const totalSize = rowVirtualizer.getTotalSize();
            const paddingTop = virtualItems.length ? virtualItems[0]!.start : 0;
            const paddingBottom = virtualItems.length
              ? totalSize - virtualItems[virtualItems.length - 1]!.end
              : 0;
            return (
              <div style={{ position: "relative" }}>
                {paddingTop > 0 && (
                  <div aria-hidden="true" style={{ height: paddingTop }} />
                )}
                {virtualItems.map((virtualRow) => {
                  const row = visibleRows[virtualRow.index]!;
                  return (
                    <div key={row.key} data-index={virtualRow.index}>
                      {renderVisibleRow(row)}
                    </div>
                  );
                })}
                {paddingBottom > 0 && (
                  <div aria-hidden="true" style={{ height: paddingBottom }} />
                )}
              </div>
            );
          })()
        : schemas.map((schema, schemaIndex) => {
            const isExpanded =
              treeShape === "with-schema"
                ? expandedSchemas.has(schema.name)
                : true; // Sprint 135 — MySQL/SQLite shapes always expose
            // categories/tables; the schema row is hidden but
            // the expansion state is implicit "open".
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
                {/* Section separator between schemas — only meaningful for
                    PG-style shape where the schema row demarcates groups. */}
                {treeShape === "with-schema" && schemaIndex > 0 && (
                  <div className="mx-3 my-0.5 border-t border-border" />
                )}

                {/* Schema row — Sprint 135: rendered only for `with-schema`
                    shape (PG / future MSSQL). MySQL/SQLite suppress this row
                    so the tree starts at the next level (categories or
                    tables respectively). */}
                {treeShape === "with-schema" && (
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <button
                        type="button"
                        className={`flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted ${
                          isSchemaSelected
                            ? "bg-muted text-foreground"
                            : "text-secondary-foreground"
                        }`}
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
                          <Folder
                            size={13}
                            className="shrink-0 text-muted-foreground"
                          />
                        )}
                        <span className="truncate">{schema.name}</span>
                        {isLoadingTables && (
                          <Loader2 size={10} className="ml-auto animate-spin" />
                        )}
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        onClick={() => handleRefreshSchema(schema.name)}
                      >
                        <RefreshCw size={14} />
                        Refresh
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                )}

                {/* Category sections under expanded schema. For SQLite
                    (`flat` shape) we skip the category headers entirely
                    and render the table list directly so the user sees a
                    1-level tree (root → table). MySQL (`no-schema`) keeps
                    the categories so views/functions still surface. */}
                {isExpanded && treeShape === "flat" && (
                  <div>
                    {isLoadingTables && schemaTables.length === 0 ? (
                      <div className="px-3 py-1 text-xs text-muted-foreground">
                        Loading...
                      </div>
                    ) : schemaTables.length === 0 ? (
                      <div className="px-3 py-1 text-2xs italic text-muted-foreground">
                        No tables
                      </div>
                    ) : (
                      schemaTables.map((item) => {
                        const itemId = nodeIdToString({
                          type: "table",
                          schema: schema.name,
                          table: item.name,
                        });
                        const isSelected = selectedNodeId === itemId;
                        const isActive =
                          activeSchema === schema.name &&
                          activeTable === item.name;
                        const handleClick = () =>
                          handleTableClick(item.name, schema.name);
                        return (
                          <ContextMenu key={`flat-${item.name}`}>
                            <ContextMenuTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-3 hover:bg-muted",
                                  isSelected || isActive
                                    ? "bg-primary/10 text-primary font-semibold"
                                    : "text-foreground",
                                )}
                                aria-label={`${item.name} table`}
                                onClick={handleClick}
                                onDoubleClick={() =>
                                  handleTableDoubleClick(item.name, schema.name)
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleClick();
                                  } else if (e.key === "F2") {
                                    e.preventDefault();
                                    handleStartRename(item.name, schema.name);
                                  }
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
                                  // Sprint 137 (AC-S137-03) — see
                                  // `rowCountLabel` for the DBMS-aware
                                  // semantics. Rendered identically in the
                                  // virtualized + nested + flat paths so
                                  // a regression in any one path is caught
                                  // by the same test.
                                  <span
                                    className="ml-auto text-3xs text-muted-foreground"
                                    data-row-count="true"
                                    aria-label={rowCountLabel(dbType)}
                                    title={rowCountLabel(dbType)}
                                  >
                                    {item.row_count.toLocaleString()}
                                  </span>
                                )}
                              </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent>
                              <ContextMenuItem
                                onClick={() =>
                                  handleOpenStructure(item.name, schema.name)
                                }
                              >
                                <Columns3 size={14} /> Structure
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() =>
                                  handleTableClick(item.name, schema.name)
                                }
                              >
                                <Table2 size={14} /> Data
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() =>
                                  handleStartRename(item.name, schema.name)
                                }
                              >
                                <Pencil size={14} /> Rename
                              </ContextMenuItem>
                              <ContextMenuItem
                                danger
                                onClick={() =>
                                  handleDropTable(item.name, schema.name)
                                }
                              >
                                <Trash2 size={14} /> Drop
                              </ContextMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })
                    )}
                  </div>
                )}

                {/* PG-style and MySQL-style: render the standard category
                    cascade. For MySQL (`no-schema`) the schema row above
                    is suppressed but the categories collapse/expand the
                    same way as PG. */}
                {isExpanded && treeShape !== "flat" && (
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

                        const schemaKey = `${connectionId}:${schema.name}`;
                        const schemaViews: ViewInfo[] = views[schemaKey] ?? [];
                        const schemaFunctions: FunctionInfo[] =
                          functions[schemaKey] ?? [];

                        // Build items based on category type
                        const isTableCat = cat.key === "tables";
                        const isViewCat = cat.key === "views";
                        const isFunctionCat = cat.key === "functions";
                        const isProcedureCat = cat.key === "procedures";

                        const unfilteredItems: (
                          | TableInfo
                          | ViewInfo
                          | FunctionInfo
                        )[] = isTableCat
                          ? schemaTables
                          : isViewCat
                            ? schemaViews
                            : isFunctionCat
                              ? schemaFunctions.filter(
                                  (f) =>
                                    f.kind === "function" ||
                                    f.kind === "aggregate" ||
                                    f.kind === "window",
                                )
                              : isProcedureCat
                                ? schemaFunctions.filter(
                                    (f) => f.kind === "procedure",
                                  )
                                : [];
                        const searchValue = isTableCat
                          ? (tableSearch[schema.name] ?? "")
                          : "";
                        const searchLower = searchValue.toLowerCase();
                        const items: (TableInfo | ViewInfo | FunctionInfo)[] =
                          isTableCat
                            ? searchLower
                              ? unfilteredItems.filter((t) =>
                                  t.name.toLowerCase().includes(searchLower),
                                )
                              : unfilteredItems
                            : unfilteredItems;

                        const itemCount = items.length;

                        return (
                          <div key={cat.key}>
                            {/* Category header */}
                            <button
                              type="button"
                              className={`flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-6 text-2xs font-medium hover:bg-muted ${
                                isCatSelected
                                  ? "bg-muted text-foreground"
                                  : "text-secondary-foreground"
                              }`}
                              aria-expanded={catExpanded}
                              aria-label={`${cat.label} in ${schema.name}`}
                              onClick={() =>
                                toggleCategory(schema.name, cat.key)
                              }
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
                              {itemCount > 0 && (
                                <span className="ml-auto text-3xs text-muted-foreground">
                                  {itemCount}
                                </span>
                              )}
                            </button>

                            {/* Category content. Sprint 136 (AC-S136-05) —
                                the function/procedure categories cap their
                                items list height with `max-h-[50vh] +
                                overflow-y-auto` so an expanded function
                                category cannot push schema rows or other
                                categories out of the viewport. Tables/Views
                                already paginate via the search input + table
                                count, so the cap targets only the two
                                categories with unbounded length. */}
                            {catExpanded && (
                              <div
                                className={
                                  isFunctionCat || isProcedureCat
                                    ? "max-h-[50vh] overflow-y-auto"
                                    : undefined
                                }
                                data-category-overflow={
                                  isFunctionCat || isProcedureCat
                                    ? "capped"
                                    : undefined
                                }
                              >
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
                                        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
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
                                        <Button
                                          variant="ghost"
                                          size="icon-xs"
                                          onClick={() =>
                                            setTableSearch((prev) => {
                                              const next = { ...prev };
                                              delete next[schema.name];
                                              return next;
                                            })
                                          }
                                          aria-label={`Clear table filter in ${schema.name}`}
                                        >
                                          <X />
                                        </Button>
                                      )}
                                    </div>
                                  )}
                                {items.length === 0 ? (
                                  <div className="px-10 py-1 text-2xs italic text-muted-foreground">
                                    {cat.key === "tables" && searchValue
                                      ? "No matching tables"
                                      : cat.emptyLabel}
                                  </div>
                                ) : (
                                  items.map((item) => {
                                    // Determine item type and rendering
                                    const isTableView = isTableCat;
                                    const isView = isViewCat;
                                    const isFunc =
                                      isFunctionCat || isProcedureCat;

                                    const itemId = isTableView
                                      ? nodeIdToString({
                                          type: "table",
                                          schema: schema.name,
                                          table: item.name,
                                        })
                                      : isView
                                        ? nodeIdToString({
                                            type: "view",
                                            schema: schema.name,
                                            view: item.name,
                                          })
                                        : nodeIdToString({
                                            type: "function",
                                            schema: schema.name,
                                            functionName: item.name,
                                          });

                                    const isSelected =
                                      selectedNodeId === itemId;
                                    const isActive =
                                      activeSchema === schema.name &&
                                      activeTable === item.name;

                                    const handleClick = () => {
                                      if (isView) {
                                        handleViewClick(item.name, schema.name);
                                      } else if (isFunc) {
                                        handleFunctionClick(
                                          item.name,
                                          schema.name,
                                        );
                                      } else {
                                        handleTableClick(
                                          item.name,
                                          schema.name,
                                        );
                                      }
                                    };

                                    return (
                                      <ContextMenu
                                        key={`${cat.key}-${item.name}`}
                                      >
                                        <ContextMenuTrigger asChild>
                                          <button
                                            type="button"
                                            className={cn(
                                              "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-10 hover:bg-muted",
                                              isSelected || isActive
                                                ? "bg-primary/10 text-primary font-semibold"
                                                : "text-foreground",
                                            )}
                                            aria-label={`${item.name} ${isView ? "view" : isFunc ? "function" : "table"}`}
                                            onClick={handleClick}
                                            onDoubleClick={() => {
                                              // Sprint 136 (AC-S136-02) —
                                              // double-click promotes the
                                              // preview tab to persistent.
                                              // Only meaningful for table
                                              // rows; views/functions don't
                                              // share the preview slot.
                                              if (isTableView) {
                                                handleTableDoubleClick(
                                                  item.name,
                                                  schema.name,
                                                );
                                              }
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === "Enter") {
                                                handleClick();
                                              } else if (
                                                e.key === "F2" &&
                                                isTableView &&
                                                !isView &&
                                                !isFunc
                                              ) {
                                                e.preventDefault();
                                                handleStartRename(
                                                  item.name,
                                                  schema.name,
                                                );
                                              }
                                            }}
                                          >
                                            {isView ? (
                                              <Eye
                                                size={12}
                                                className="shrink-0 text-muted-foreground"
                                              />
                                            ) : isFunc ? (
                                              <Code2
                                                size={12}
                                                className="shrink-0 text-muted-foreground"
                                              />
                                            ) : (
                                              <Table2
                                                size={12}
                                                className="shrink-0 text-muted-foreground"
                                              />
                                            )}
                                            <span className="truncate text-xs">
                                              {item.name}
                                            </span>
                                            {isTableView &&
                                              "row_count" in item &&
                                              (item as TableInfo).row_count !=
                                                null && (
                                                // Sprint 137 (AC-S137-03) —
                                                // PG row count is an estimate
                                                // (`pg_class.reltuples`); see
                                                // `rowCountLabel` for the
                                                // DBMS-aware text.
                                                <span
                                                  className="ml-auto text-3xs text-muted-foreground"
                                                  data-row-count="true"
                                                  aria-label={rowCountLabel(
                                                    dbType,
                                                  )}
                                                  title={rowCountLabel(dbType)}
                                                >
                                                  {(
                                                    item as TableInfo
                                                  ).row_count!.toLocaleString()}
                                                </span>
                                              )}
                                            {isFunc &&
                                              "arguments" in item &&
                                              (item as FunctionInfo)
                                                .arguments && (
                                                <span className="ml-auto truncate text-3xs text-muted-foreground">
                                                  {
                                                    (item as FunctionInfo)
                                                      .arguments
                                                  }
                                                </span>
                                              )}
                                          </button>
                                        </ContextMenuTrigger>
                                        <ContextMenuContent>
                                          {isTableView ? (
                                            <>
                                              <ContextMenuItem
                                                onClick={() =>
                                                  handleOpenStructure(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Columns3 size={14} /> Structure
                                              </ContextMenuItem>
                                              <ContextMenuItem
                                                onClick={() =>
                                                  handleTableClick(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Table2 size={14} /> Data
                                              </ContextMenuItem>
                                              <ContextMenuItem
                                                onClick={() =>
                                                  handleStartRename(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Pencil size={14} /> Rename
                                              </ContextMenuItem>
                                              <ContextMenuItem
                                                danger
                                                onClick={() =>
                                                  handleDropTable(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Trash2 size={14} /> Drop
                                              </ContextMenuItem>
                                            </>
                                          ) : isView ? (
                                            <>
                                              <ContextMenuItem
                                                onClick={() =>
                                                  handleOpenViewStructure(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Columns3 size={14} /> Structure
                                              </ContextMenuItem>
                                              <ContextMenuItem
                                                onClick={() =>
                                                  handleViewClick(
                                                    item.name,
                                                    schema.name,
                                                  )
                                                }
                                              >
                                                <Table2 size={14} /> Data
                                              </ContextMenuItem>
                                            </>
                                          ) : (
                                            <ContextMenuItem
                                              onClick={() =>
                                                handleFunctionClick(
                                                  item.name,
                                                  schema.name,
                                                )
                                              }
                                            >
                                              <Code2 size={14} /> View Source
                                            </ContextMenuItem>
                                          )}
                                        </ContextMenuContent>
                                      </ContextMenu>
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDialog(null)}
                disabled={isOperating}
              >
                Cancel
              </Button>
              <Button
                variant={confirmDialog?.danger ? "destructive" : "default"}
                size="sm"
                onClick={confirmDialog?.onConfirm}
                disabled={isOperating}
                aria-label={confirmDialog?.confirmLabel}
              >
                {isOperating ? "Dropping..." : confirmDialog?.confirmLabel}
              </Button>
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
              onFocus={(e) => e.currentTarget.select()}
              aria-label="New table name"
            />
            {renameError && (
              <p className="mb-2 text-xs text-destructive">{renameError}</p>
            )}
            <DialogFooter className="mt-3 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRenameDialog(null)}
                disabled={isOperating}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleConfirmRename}
                disabled={isOperating}
                aria-label="Rename"
              >
                {isOperating ? "Renaming..." : "Rename"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
