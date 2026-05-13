import type { Dispatch, SetStateAction } from "react";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  Loader2,
  Code2,
  FolderOpen,
  Folder,
  Eye,
  Columns3,
  Trash2,
  Pencil,
  Plus,
  X,
  Search,
  RefreshCw,
  Zap,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@components/ui/context-menu";
import { Button } from "@components/ui/button";
import type { TableInfo, FunctionInfo } from "@/types/schema";
import { cn } from "@lib/utils";
import {
  rowCountLabel,
  rowCountText,
  type CategoryKey,
  type VisibleRow,
} from "./treeRows";

/**
 * Leaf row renderers consumed by both `SchemaTreeBody` paths
 * (eager-nested and virtualized) so they emit the same cell DOM.
 * `renderItemRow` branches on `flat` for SQLite (pl-3, tables only) vs.
 * the default (pl-10, view/function variants). `ctx`
 * (`SchemaTreeRowsContext`) bundles the entry's `useSchemaTreeActions()`
 * result plus `dbType` — these components never read stores directly.
 */

export interface SchemaTreeRowsContext {
  dbType: string | undefined;
  toggleCategory: (schemaName: string, categoryKey: CategoryKey) => void;
  setSelectedNodeId: (id: string | null) => void;
  setTableSearch: Dispatch<SetStateAction<Record<string, string>>>;
  isCategoryExpanded: (schemaName: string, key: CategoryKey) => boolean;
  handleExpandSchema: (schemaName: string) => Promise<void>;
  handleRefreshSchema: (schemaName: string) => void;
  handleTableClick: (tableName: string, schemaName: string) => void;
  handleTableDoubleClick: (tableName: string, schemaName: string) => void;
  handleOpenStructure: (tableName: string, schemaName: string) => void;
  handleDropTable: (tableName: string, schemaName: string) => void;
  handleStartRename: (tableName: string, schemaName: string) => void;
  handleViewClick: (viewName: string, schemaName: string) => void;
  handleOpenViewStructure: (viewName: string, schemaName: string) => void;
  handleFunctionClick: (funcName: string, schemaName: string) => void;
  handleCreateTable: (schemaName: string) => void;
  /**
   * Sprint 273 — open the `CreateTriggerDialog` modal pre-populated with
   * the parent table identity. Wired to the Table row's "Create
   * Trigger…" context-menu entry AND the `+` affordance on the per-table
   * Triggers group header.
   */
  handleCreateTrigger: (tableName: string, schemaName: string) => void;
  /**
   * Sprint 272 — open the read-only Triggers sub-tab of `StructurePanel`
   * for the given table. Wired to the Table row's "View Triggers"
   * context-menu entry. Reuses `handleOpenStructure` semantics (opens a
   * Structure tab); the StructurePanel itself routes to the Triggers
   * sub-tab via the `initialSubTab` prop.
   */
  handleViewTableTriggers: (tableName: string, schemaName: string) => void;
  /**
   * Sprint 272 — toggle the Triggers child group expansion under a
   * Table row. On expand, dispatches the lazy `getTableTriggers` IPC
   * once and caches the result on the store.
   */
  toggleTriggerGroup: (schemaName: string, tableName: string) => void;
  /**
   * Sprint 272 — retry affordance for the italic "Failed to load
   * triggers" placeholder row. Clears the recorded error + re-dispatches.
   */
  retryLoadTriggers: (schemaName: string, tableName: string) => void;
  /**
   * Sprint 272 — open the StructurePanel Triggers sub-tab for the
   * trigger's parent table. The trigger name is currently informational
   * (StructurePanel renders all triggers for the table); Sprint 273/274
   * will refine this with a scroll-to-trigger affordance.
   */
  handleViewTriggerSource: (
    triggerName: string,
    tableName: string,
    schemaName: string,
  ) => void;
}

export function renderSchemaRow(
  row: Extract<VisibleRow, { kind: "schema" }>,
  ctx: SchemaTreeRowsContext,
) {
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
            ctx.handleExpandSchema(row.schemaName);
            ctx.setSelectedNodeId(schemaId);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              ctx.handleExpandSchema(row.schemaName);
              ctx.setSelectedNodeId(schemaId);
            }
          }}
        >
          {row.isExpanded ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0" />
          )}
          {row.isExpanded ? (
            <FolderOpen size={13} className="shrink-0 text-muted-foreground" />
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
        <ContextMenuItem onClick={() => ctx.handleCreateTable(row.schemaName)}>
          <Plus size={14} />
          Create Table…
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => ctx.handleRefreshSchema(row.schemaName)}
        >
          <RefreshCw size={14} />
          Refresh
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function renderCategoryRow(
  row: Extract<VisibleRow, { kind: "category" }>,
  ctx: SchemaTreeRowsContext,
) {
  const cat = row.category;
  const isTables = cat.key === "tables";
  return (
    <div
      className={cn(
        "flex w-full items-center hover:bg-muted",
        row.isSelected && "bg-muted",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex flex-1 cursor-pointer items-center gap-1.5 py-0.5 pr-1 pl-6 text-2xs font-medium",
          row.isSelected ? "text-foreground" : "text-secondary-foreground",
        )}
        aria-expanded={row.isExpanded}
        aria-label={`${cat.label} in ${row.schemaName}`}
        onClick={() => ctx.toggleCategory(row.schemaName, cat.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ctx.toggleCategory(row.schemaName, cat.key);
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
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
        {isTables && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.handleCreateTable(row.schemaName);
            }}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Create table in ${row.schemaName}`}
            title="Create Table"
          >
            <Plus size={12} />
          </button>
        )}
        {row.itemCount > 0 && (
          <span className="text-3xs text-muted-foreground">
            {row.itemCount}
          </span>
        )}
      </div>
    </div>
  );
}

export function renderSearchRow(
  row: Extract<VisibleRow, { kind: "search" }>,
  ctx: SchemaTreeRowsContext,
) {
  return (
    <div className="flex items-center gap-1 px-8 py-0.5">
      <Search size={11} className="shrink-0 text-muted-foreground" />
      <input
        type="text"
        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
        placeholder="Filter tables..."
        value={row.searchValue}
        onChange={(e) =>
          ctx.setTableSearch((prev) => ({
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
            ctx.setTableSearch((prev) => {
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
}

export function renderEmptyRow(row: Extract<VisibleRow, { kind: "empty" }>) {
  return (
    <div className="px-10 py-1 text-2xs italic text-muted-foreground">
      {row.category.key === "tables" && row.hasActiveSearch
        ? "No matching tables"
        : row.category.emptyLabel}
    </div>
  );
}

/**
 * Item row renderer. `flat=true` 면 SQLite-style flat branch — `pl-3`
 * 이고 view/function 가 아예 안 들어옴 (caller 가 보장). 일반 모드는
 * `pl-10` 이고 view/function 분기 모두 처리. ContextMenu 항목도 모드별
 * 분기.
 */
export function renderItemRow(
  row: Extract<VisibleRow, { kind: "item" }>,
  ctx: SchemaTreeRowsContext,
  flat = false,
) {
  const item = row.item;
  const isTableItem = row.itemKind === "table";
  const isView = row.itemKind === "view";
  const isFunc = row.itemKind === "function";

  const handleClick = () => {
    if (isView) ctx.handleViewClick(item.name, row.schemaName);
    else if (isFunc) ctx.handleFunctionClick(item.name, row.schemaName);
    else ctx.handleTableClick(item.name, row.schemaName);
  };

  // Double-click promotes the preview tab to persistent. Only meaningful
  // for tables — views/functions don't participate in the preview slot.
  const handleDoubleClick = () => {
    if (isTableItem) ctx.handleTableDoubleClick(item.name, row.schemaName);
  };

  const indentClass = flat ? "pl-3" : "pl-10";

  // 2026-05-11 — split the highlight rule by itemKind. Tables and views
  // open as table-type tabs, so their highlight follows `isActive`
  // (active-tab match) exclusively — `selectedNodeId` is no longer set
  // on table/view clicks, which prevented a stale highlight from
  // surviving tab switches. Functions open as query tabs (no active-tab
  // match possible) so they stay on the click-driven `isSelected` path.
  const isHighlighted = isFunc ? row.isSelected : row.isActive;

  return (
    <ContextMenu key={row.key}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 hover:bg-muted",
            indentClass,
            isHighlighted
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground",
          )}
          aria-label={`${item.name} ${
            isView ? "view" : isFunc ? "function" : "table"
          }`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleClick();
            else if (e.key === "F2" && isTableItem) {
              e.preventDefault();
              ctx.handleStartRename(item.name, row.schemaName);
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
          {isTableItem && "row_count" in item && (
            <span
              className="ml-auto text-3xs text-muted-foreground"
              data-row-count="true"
              aria-label={rowCountLabel(
                ctx.dbType,
                (item as TableInfo).row_count,
              )}
              title={rowCountLabel(ctx.dbType, (item as TableInfo).row_count)}
            >
              {rowCountText(ctx.dbType, (item as TableInfo).row_count)}
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
              onClick={() => ctx.handleOpenStructure(item.name, row.schemaName)}
            >
              <Columns3 size={14} /> Structure
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleTableClick(item.name, row.schemaName)}
            >
              <Table2 size={14} /> Data
            </ContextMenuItem>
            {/* Sprint 272 — Trigger affordances on the Table row. View
                Triggers is enabled (opens Structure → Triggers sub-tab).
                Sprint 273 — Create Trigger is wired to the new
                CreateTriggerDialog. Drop is still a disabled placeholder
                (Sprint 274). */}
            <ContextMenuItem
              onClick={() =>
                ctx.handleViewTableTriggers(item.name, row.schemaName)
              }
              aria-label={`View triggers for ${item.name}`}
            >
              <Zap size={14} /> View Triggers
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleCreateTrigger(item.name, row.schemaName)}
              aria-label={`Create trigger on ${item.name}`}
            >
              <Plus size={14} /> Create Trigger…
            </ContextMenuItem>
            <ContextMenuItem
              danger
              disabled
              aria-label="Drop trigger"
              title="Drop Trigger is coming soon"
            >
              <Trash2 size={14} /> Drop Trigger…
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleStartRename(item.name, row.schemaName)}
            >
              <Pencil size={14} /> Rename
            </ContextMenuItem>
            <ContextMenuItem
              danger
              onClick={() => ctx.handleDropTable(item.name, row.schemaName)}
            >
              <Trash2 size={14} /> Drop
            </ContextMenuItem>
          </>
        ) : isView ? (
          <>
            <ContextMenuItem
              onClick={() =>
                ctx.handleOpenViewStructure(item.name, row.schemaName)
              }
            >
              <Columns3 size={14} /> Structure
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleViewClick(item.name, row.schemaName)}
            >
              <Table2 size={14} /> Data
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem
            onClick={() => ctx.handleFunctionClick(item.name, row.schemaName)}
          >
            <Code2 size={14} /> View Source
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Sprint 272 — Triggers child group header row. Renders directly under
 * each Table row at indent `pl-14` (one level deeper than the table row
 * at `pl-10`). Toggles its expansion via `ctx.toggleTriggerGroup`. The
 * count badge appears once the cache has resolved
 * (`triggerCount != null`); before that the row is just "Triggers".
 */
export function renderTriggerGroupRow(
  row: Extract<VisibleRow, { kind: "trigger-group" }>,
  ctx: SchemaTreeRowsContext,
) {
  return (
    <div
      className={cn(
        "flex w-full items-center hover:bg-muted",
        row.isSelected && "bg-muted",
      )}
    >
      <button
        type="button"
        className={cn(
          "flex flex-1 cursor-pointer items-center gap-1.5 py-0.5 pr-1 pl-14 text-2xs font-medium",
          row.isSelected ? "text-foreground" : "text-secondary-foreground",
        )}
        aria-expanded={row.isExpanded}
        aria-label={`Triggers for ${row.tableName} in ${row.schemaName}`}
        onClick={() => ctx.toggleTriggerGroup(row.schemaName, row.tableName)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ctx.toggleTriggerGroup(row.schemaName, row.tableName);
          }
        }}
      >
        {row.isExpanded ? (
          <ChevronDown size={11} className="shrink-0" />
        ) : (
          <ChevronRight size={11} className="shrink-0" />
        )}
        <Zap size={11} className="shrink-0 text-muted-foreground" />
        <span>Triggers</span>
        {row.isLoading && (
          <Loader2 size={10} className="ml-1 shrink-0 animate-spin" />
        )}
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
        {row.triggerCount != null && row.triggerCount > 0 && (
          <span
            className="text-3xs text-muted-foreground"
            data-testid={`trigger-count-${row.schemaName}-${row.tableName}`}
          >
            {row.triggerCount}
          </span>
        )}
        {/* Sprint 273 — Plus affordance on the Triggers group header.
            Mirrors the "+" pattern used by other category headers
            (e.g. Tables group → Create Table). Opens the
            CreateTriggerDialog pre-populated with this row's parent
            table identity. */}
        <button
          type="button"
          className="flex shrink-0 items-center justify-center rounded p-0.5 text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
          aria-label={`Create trigger on ${row.tableName}`}
          onClick={(e) => {
            e.stopPropagation();
            ctx.handleCreateTrigger(row.tableName, row.schemaName);
          }}
          title="Create Trigger"
        >
          <Plus size={11} />
        </button>
      </div>
    </div>
  );
}

/** Sprint 272 — italic "Loading triggers…" placeholder. */
export function renderTriggerLoadingRow(
  row: Extract<VisibleRow, { kind: "trigger-loading" }>,
) {
  return (
    <div
      className="pl-[4.5rem] pr-3 py-0.5 text-2xs italic text-muted-foreground"
      aria-label={`Loading triggers for ${row.tableName}`}
    >
      Loading triggers…
    </div>
  );
}

/** Sprint 272 — italic "No triggers" placeholder (fetched + empty). */
export function renderTriggerEmptyRow(
  row: Extract<VisibleRow, { kind: "trigger-empty" }>,
) {
  return (
    <div
      className="pl-[4.5rem] pr-3 py-0.5 text-2xs italic text-muted-foreground"
      aria-label={`No triggers for ${row.tableName}`}
    >
      No triggers
    </div>
  );
}

/** Sprint 272 — italic red "Failed to load triggers" + Retry button. */
export function renderTriggerErrorRow(
  row: Extract<VisibleRow, { kind: "trigger-error" }>,
  ctx: SchemaTreeRowsContext,
) {
  return (
    <div className="flex items-center gap-1 pl-[4.5rem] pr-3 py-0.5 text-2xs italic text-destructive">
      <span
        title={row.message}
        aria-label={`Failed to load triggers for ${row.tableName}`}
      >
        Failed to load triggers
      </span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => ctx.retryLoadTriggers(row.schemaName, row.tableName)}
        aria-label={`Retry loading triggers for ${row.tableName}`}
        title="Retry"
      >
        <RefreshCw size={10} />
      </Button>
    </div>
  );
}

/**
 * Sprint 272 — individual trigger row. Right-click exposes the
 * per-trigger context menu: "View Source" (enabled, opens Triggers
 * sub-tab), "Create Trigger…" (disabled placeholder for Sprint 273),
 * "Drop Trigger…" (disabled placeholder for Sprint 274).
 */
export function renderTriggerItemRow(
  row: Extract<VisibleRow, { kind: "trigger-item" }>,
  ctx: SchemaTreeRowsContext,
) {
  const trig = row.trigger;
  return (
    <ContextMenu key={row.key}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pl-[4.5rem] pr-3 hover:bg-muted",
            row.isSelected
              ? "bg-primary/10 text-primary font-semibold"
              : "text-foreground",
          )}
          aria-label={`Trigger ${trig.name} on ${row.tableName}`}
          onClick={() =>
            ctx.handleViewTriggerSource(
              trig.name,
              row.tableName,
              row.schemaName,
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              ctx.handleViewTriggerSource(
                trig.name,
                row.tableName,
                row.schemaName,
              );
            }
          }}
        >
          <Zap size={11} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-2xs">{trig.name}</span>
          {trig.timing && (
            <span className="ml-auto truncate text-3xs text-muted-foreground">
              {trig.timing}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          onClick={() =>
            ctx.handleViewTriggerSource(
              trig.name,
              row.tableName,
              row.schemaName,
            )
          }
          aria-label={`View source for trigger ${trig.name}`}
        >
          <Code2 size={14} /> View Source
        </ContextMenuItem>
        <ContextMenuItem
          onClick={() => ctx.handleCreateTrigger(row.tableName, row.schemaName)}
          aria-label={`Create trigger on ${row.tableName}`}
        >
          <Plus size={14} /> Create Trigger…
        </ContextMenuItem>
        <ContextMenuItem
          danger
          disabled
          aria-label="Drop trigger"
          title="Drop Trigger is coming soon"
        >
          <Trash2 size={14} /> Drop Trigger…
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Dispatcher used by virtualized branch — flat-list `VisibleRow` → JSX. */
export function renderVisibleRow(
  row: VisibleRow,
  ctx: SchemaTreeRowsContext,
): React.ReactNode {
  switch (row.kind) {
    case "schema-separator":
      return <div className="mx-3 my-0.5 border-t border-border" />;
    case "schema":
      return renderSchemaRow(row, ctx);
    case "loading":
      return (
        <div className="px-8 py-1 text-xs text-muted-foreground">
          Loading...
        </div>
      );
    case "category":
      return renderCategoryRow(row, ctx);
    case "search":
      return renderSearchRow(row, ctx);
    case "empty":
      return renderEmptyRow(row);
    case "item":
      return renderItemRow(row, ctx);
    case "trigger-group":
      return renderTriggerGroupRow(row, ctx);
    case "trigger-loading":
      return renderTriggerLoadingRow(row);
    case "trigger-empty":
      return renderTriggerEmptyRow(row);
    case "trigger-error":
      return renderTriggerErrorRow(row, ctx);
    case "trigger-item":
      return renderTriggerItemRow(row, ctx);
  }
}
