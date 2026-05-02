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
  X,
  Search,
  RefreshCw,
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
 * Sprint 199 — leaf row renderers extracted from `SchemaTree.tsx` body.
 * `<SchemaTreeBody>` (eager nested + virtualized 양쪽) 가 호출 → 두 path
 * 가 같은 cell DOM 을 내는 회귀 가드.
 *
 * `renderItemRow` 는 일반 (pl-10, view/function 분기 포함) 과 flat-shape
 * (SQLite, pl-3, table only) 두 모드를 `flat` flag 로 분기. flat 분기는
 * pre-split 의 SchemaTree.tsx flat branch (lines 1485-1576) 와 byte-for-
 * byte 동등.
 *
 * `ctx` (SchemaTreeRowsContext) 가 entry 의 `useSchemaTreeActions()`
 * 결과 + `dbType` 묶음 — store hook 직접 호출 X (테스트 mock 단순화).
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
      {row.itemCount > 0 && (
        <span className="ml-auto text-3xs text-muted-foreground">
          {row.itemCount}
        </span>
      )}
    </button>
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

  // Sprint 136 — double-click promotes the preview tab to a persistent
  // tab (AC-S136-02). Only meaningful for table rows; views/functions
  // either spawn dedicated tabs (views) or query tabs (functions) which
  // do not participate in the table-preview slot.
  const handleDoubleClick = () => {
    if (isTableItem) ctx.handleTableDoubleClick(item.name, row.schemaName);
  };

  const indentClass = flat ? "pl-3" : "pl-10";

  return (
    <ContextMenu key={row.key}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 hover:bg-muted",
            indentClass,
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
  }
}
