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
  Download,
  FileText,
  Rows3,
  Database,
  ListOrdered,
  Link2,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@components/ui/context-menu";
import { Button } from "@components/ui/button";
import type { TableInfo, FunctionInfo } from "@/types/schema";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type { ExportInclude } from "@/hooks/useMigrationExport";
import { cn } from "@lib/utils";
import {
  nodeIdToString,
  rowCountLabel,
  rowCountText,
  type CategoryKey,
  type VisibleRow,
} from "./treeRows";
import type { RdbTreeShape } from "../treeShape";

// Sprint 301 — schema / table 컨텍스트 메뉴의 Export sub-menu 가 사용하는
// 세 가지 export include 모드. DDL / Data (DML) / Full (DDL + Data).
// Data 와 Full 은 현재 PostgreSQL 만 실제로 동작 — MySQL / SQLite 는
// stream_table_rows 가 Unsupported 라 useMigrationExport 가 toast 로
// 사용자에게 알리며 종료. UI 는 모든 driver 에 동일하게 노출한다.
const EXPORT_MODES: ReadonlyArray<{
  include: ExportInclude;
  label: string;
  Icon: typeof FileText;
}> = [
  { include: "ddl", label: "DDL (CREATE only)", Icon: FileText },
  { include: "dml", label: "Data (INSERT only)", Icon: Rows3 },
  { include: "both", label: "Full dump (DDL + data)", Icon: Database },
];

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
  // Sprint 380 — needed by category/item row renderers to choose a
  // 3-way indent class (PG `with-schema` → deepest, MySQL `no-schema`
  // → one step less, SQLite `flat` → root level).
  treeShape: RdbTreeShape;
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
  handleExportSchema: (schemaName: string, include: ExportInclude) => void;
  handleExportTable: (
    tableName: string,
    schemaName: string,
    include: ExportInclude,
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
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <Download size={14} />
            Export Schema…
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            {EXPORT_MODES.map(({ include, label, Icon }) => (
              <ContextMenuItem
                key={include}
                onClick={() => ctx.handleExportSchema(row.schemaName, include)}
              >
                <Icon size={14} /> {label}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
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
          "flex flex-1 cursor-pointer items-center gap-1.5 py-0.5 pr-1 text-2xs font-medium",
          // Sprint 380 — MySQL (`no-schema`) drops the schema-level
          // indent step because there is no schema row above; PG
          // (`with-schema`) keeps the deeper indent.
          ctx.treeShape === "no-schema" ? "pl-3" : "pl-6",
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

export function renderFileAnalyticsSourceRow(
  metadata: FileAnalyticsSourceMetadata,
) {
  const { source } = metadata;
  const columnText =
    metadata.columns
      .map((column) => column.name)
      .filter(Boolean)
      .join(", ") || "No columns";

  return (
    <div
      key={`source-${source.id}`}
      aria-label={`${source.alias} source`}
      className="flex w-full items-center gap-1.5 px-3 py-0.5 text-foreground hover:bg-muted"
    >
      <FileText size={12} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-xs">{source.alias}</span>
      <span className="max-w-[7rem] truncate text-3xs text-muted-foreground">
        {source.fileName}
      </span>
      <span className="max-w-[8rem] truncate text-3xs text-muted-foreground">
        {columnText}
      </span>
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
  const isMetadata = row.itemKind === "metadata";
  const isSequence = isMetadata && row.categoryKey === "sequences";
  const itemLabel = isView
    ? "view"
    : isFunc
      ? "function"
      : isSequence
        ? "sequence"
        : isMetadata
          ? "synonym"
          : "table";

  const handleClick = () => {
    if (isView) ctx.handleViewClick(item.name, row.schemaName);
    else if (isFunc) ctx.handleFunctionClick(item.name, row.schemaName);
    else if (isMetadata) {
      ctx.setSelectedNodeId(
        nodeIdToString({
          type: "object",
          schema: row.schemaName,
          category: row.categoryKey,
          objectName: item.name,
        }),
      );
    } else ctx.handleTableClick(item.name, row.schemaName);
  };

  // Double-click promotes the preview tab to persistent. Only meaningful
  // for tables — views/functions don't participate in the preview slot.
  const handleDoubleClick = () => {
    if (isTableItem) ctx.handleTableDoubleClick(item.name, row.schemaName);
  };

  // Sprint 380 — 3-way indent. `flat` (SQLite) is the legacy root-level
  // path that doesn't go through categories. For the categorical path,
  // MySQL (`no-schema`) drops one indent step (pl-7 vs PG's pl-10) so
  // the table list visually nests under the category, not under a
  // missing schema row.
  const indentClass = flat
    ? "pl-3"
    : ctx.treeShape === "no-schema"
      ? "pl-7"
      : "pl-10";

  // 2026-05-11 — split the highlight rule by itemKind. Tables and views
  // open as table-type tabs, so their highlight follows `isActive`
  // (active-tab match) exclusively — `selectedNodeId` is no longer set
  // on table/view clicks, which prevented a stale highlight from
  // surviving tab switches. Functions open as query tabs (no active-tab
  // match possible) so they stay on the click-driven `isSelected` path.
  const isHighlighted = isFunc || isMetadata ? row.isSelected : row.isActive;
  const icon = isView ? (
    <Eye size={12} className="shrink-0 text-muted-foreground" />
  ) : isFunc ? (
    <Code2 size={12} className="shrink-0 text-muted-foreground" />
  ) : isSequence ? (
    <ListOrdered size={12} className="shrink-0 text-muted-foreground" />
  ) : isMetadata ? (
    <Link2 size={12} className="shrink-0 text-muted-foreground" />
  ) : (
    <Table2 size={12} className="shrink-0 text-muted-foreground" />
  );

  if (isMetadata) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 hover:bg-muted",
          indentClass,
          isHighlighted
            ? "bg-primary/10 text-primary font-semibold"
            : "text-foreground",
        )}
        aria-label={`${item.name} ${itemLabel}`}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleClick();
        }}
      >
        {icon}
        <span className="truncate text-xs">{item.name}</span>
        {"arguments" in item && (item as FunctionInfo).arguments && (
          <span className="ml-auto truncate text-3xs text-muted-foreground">
            {(item as FunctionInfo).arguments}
          </span>
        )}
      </button>
    );
  }

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
          aria-label={`${item.name} ${itemLabel}`}
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
          {icon}
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
            {/* Sprint 275 — trigger entries removed from the Table row
                context menu. Trigger CRUD now lives entirely on the
                StructurePanel Triggers tab (consolidated single entry
                point). Column/Index/Constraint surfaces don't carry
                table-row shortcuts either, so this restores consistency. */}
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Download size={14} /> Export Table…
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {EXPORT_MODES.map(({ include, label, Icon }) => (
                  <ContextMenuItem
                    key={include}
                    onClick={() =>
                      ctx.handleExportTable(item.name, row.schemaName, include)
                    }
                  >
                    <Icon size={14} /> {label}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
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
