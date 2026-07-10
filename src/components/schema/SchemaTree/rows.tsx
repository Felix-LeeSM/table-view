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
  Pin,
  PinOff,
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
import {
  supportsMigrationExport,
  type ExportInclude,
} from "@/hooks/useMigrationExport";
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
// #1048 — Export sub-menu 는 `stream_table_rows` 백엔드가 구현된 엔진
// (PG / MySQL / MariaDB) 에서만 노출한다. SQLite / DuckDB / MSSQL / Oracle
// 은 DML/Full 을 Unsupported 로 reject 하므로 노출 시 error-on-click.
const EXPORT_MODES: ReadonlyArray<{
  include: ExportInclude;
  labelKey: string;
  Icon: typeof FileText;
}> = [
  { include: "ddl", labelKey: "ddlTitle", Icon: FileText },
  { include: "dml", labelKey: "dmlTitle", Icon: Rows3 },
  { include: "both", labelKey: "fullDumpTitle", Icon: Database },
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
  t: (key: string, options?: Record<string, unknown>) => string;
  dbType: string | undefined;
  // #1052 — false for a statically read-only engine (DuckDB): its DDL entries
  // (Create / Rename / Drop table) are HIDDEN, not shown-then-erroring
  // (ui-parity §4 static unsupported = hide). True while dbType is still
  // loading so entries aren't stripped early.
  canMutateSchema: boolean;
  // Roving tabindex (WAI-ARIA tree): the row whose `key` matches owns
  // `tabIndex=0`; all others are `-1`. `onFocusRow` keeps mouse focus in
  // sync so a click moves the roving anchor.
  rovingFocusKey: string | null;
  onFocusRow: (key: string) => void;
  // Sprint 380 — needed by category/item row renderers to choose a
  // 3-way indent class (PG `with-schema` → deepest, MySQL `no-schema`
  // → one step less, SQLite `flat` → root level).
  treeShape: RdbTreeShape;
  // #1217 — true while the top-level global filter is active. The eager
  // renderer uses it to drop the per-schema search input and empty
  // categories (the flat/virtualized path handles this in `getVisibleRows`).
  globalFilterActive: boolean;
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
  // #1218 — pin/unpin a table + its current pin state (menu label toggle).
  handleTogglePin: (tableName: string, schemaName: string) => void;
  isTablePinned: (tableName: string, schemaName: string) => boolean;
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

/**
 * Roving-tabindex props shared by every `treeitem` button. The focused
 * row (or, before any focus, none) carries `tabIndex=0`; the rest are
 * `-1`. `data-tree-key` lets the container's keydown handler `.focus()` a
 * row by key after an arrow move. `onFocus` syncs the roving anchor on a
 * mouse click / programmatic focus.
 */
function rovingProps(ctx: SchemaTreeRowsContext, key: string) {
  return {
    "data-tree-key": key,
    tabIndex: ctx.rovingFocusKey === key ? 0 : -1,
    onFocus: () => ctx.onFocusRow(key),
  } as const;
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
          className={`flex w-full cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
            row.isSelected
              ? "bg-muted text-foreground"
              : "text-secondary-foreground"
          }`}
          role="treeitem"
          aria-level={1}
          aria-expanded={row.isExpanded}
          aria-label={`${row.schemaName} schema`}
          aria-describedby={
            row.tableCount > 0 ? `${schemaId}-count` : undefined
          }
          aria-selected={row.isSelected}
          {...rovingProps(ctx, schemaId)}
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
          {/* #1140 — keep the identifying aria-label (203 test queries + stable
              SR name depend on it) but expose the row-count badge to SR via
              aria-describedby so it is announced after the name instead of
              being masked by the override. Decorative chevron/folder icons are
              aria-hidden. */}
          {row.isExpanded ? (
            <ChevronDown size={12} className="shrink-0" aria-hidden />
          ) : (
            <ChevronRight size={12} className="shrink-0" aria-hidden />
          )}
          {row.isExpanded ? (
            <FolderOpen
              size={13}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
          ) : (
            <Folder
              size={13}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
          )}
          <span className="truncate text-sm">{row.schemaName}</span>
          {/* #1217 — table-count badge; readable at a glance even while the
              schema is collapsed. */}
          {row.tableCount > 0 && (
            <span
              id={`${schemaId}-count`}
              className="ml-auto shrink-0 text-3xs tabular-nums text-muted-foreground"
              aria-label={ctx.t("schemaTableCountAria", {
                count: row.tableCount,
              })}
            >
              {row.tableCount}
            </span>
          )}
          {row.isLoadingTables && (
            <Loader2
              size={10}
              className={cn(
                "shrink-0 animate-spin",
                row.tableCount > 0 ? "ml-1" : "ml-auto",
              )}
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {ctx.canMutateSchema && (
          <ContextMenuItem
            onClick={() => ctx.handleCreateTable(row.schemaName)}
          >
            <Plus size={14} />
            {ctx.t("createTableMenu")}
          </ContextMenuItem>
        )}
        {supportsMigrationExport(ctx.dbType) && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Download size={14} />
              {ctx.t("exportSchemaMenu")}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {EXPORT_MODES.map(({ include, labelKey, Icon }) => (
                <ContextMenuItem
                  key={include}
                  onClick={() =>
                    ctx.handleExportSchema(row.schemaName, include)
                  }
                >
                  <Icon size={14} /> {ctx.t(labelKey)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuItem
          onClick={() => ctx.handleRefreshSchema(row.schemaName)}
        >
          <RefreshCw size={14} />
          {ctx.t("refresh")}
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
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        )}
        role="treeitem"
        aria-level={ctx.treeShape === "no-schema" ? 1 : 2}
        aria-expanded={row.isExpanded}
        aria-label={`${ctx.t(cat.labelKey)} in ${row.schemaName}`}
        aria-selected={row.isSelected}
        {...rovingProps(ctx, row.key)}
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
        <span>{ctx.t(cat.labelKey)}</span>
      </button>
      <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
        {isTables && ctx.canMutateSchema && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              ctx.handleCreateTable(row.schemaName);
            }}
            className="inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={ctx.t("createTableInAria", { schema: row.schemaName })}
            title={ctx.t("createTableTitle")}
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
        className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-2xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={ctx.t("filterTablesPlaceholder")}
        value={row.searchValue}
        onChange={(e) =>
          ctx.setTableSearch((prev) => ({
            ...prev,
            [row.schemaName]: e.target.value,
          }))
        }
        aria-label={ctx.t("filterTablesAria", { schema: row.schemaName })}
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
          aria-label={ctx.t("clearTableFilterAria", { schema: row.schemaName })}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

export function renderEmptyRow(
  row: Extract<VisibleRow, { kind: "empty" }>,
  ctx: SchemaTreeRowsContext,
) {
  return (
    // #1137 — filter/empty category announced politely (DocumentDatabaseTree parity).
    <div
      className="px-10 py-1 text-2xs italic text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {row.category.key === "tables" && row.hasActiveSearch
        ? ctx.t("noMatchingTablesEmpty")
        : ctx.t(row.category.emptyLabelKey)}
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
      <span className="min-w-0 flex-1 truncate text-sm">{source.alias}</span>
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
  const ariaLevel = flat ? 1 : ctx.treeShape === "no-schema" ? 2 : 3;
  const icon = isView ? (
    <Eye size={12} className="shrink-0 text-muted-foreground" aria-hidden />
  ) : isFunc ? (
    <Code2 size={12} className="shrink-0 text-muted-foreground" aria-hidden />
  ) : isSequence ? (
    <ListOrdered
      size={12}
      className="shrink-0 text-muted-foreground"
      aria-hidden
    />
  ) : isMetadata ? (
    <Link2 size={12} className="shrink-0 text-muted-foreground" aria-hidden />
  ) : (
    <Table2 size={12} className="shrink-0 text-muted-foreground" aria-hidden />
  );

  if (isMetadata) {
    return (
      <button
        type="button"
        className={cn(
          "flex w-full cursor-pointer items-center gap-1.5 py-0.5 pr-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          indentClass,
          isHighlighted
            ? "bg-primary/10 text-primary font-semibold"
            : "text-foreground",
        )}
        role="treeitem"
        aria-level={ariaLevel}
        aria-label={`${item.name} ${itemLabel}`}
        aria-selected={isHighlighted}
        {...rovingProps(ctx, row.key)}
        onClick={handleClick}
        onKeyDown={(e) => {
          // #1142 — activation-key parity with schema/category rows (Enter+Space).
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
      >
        {icon}
        <span className="truncate text-sm">{item.name}</span>
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
          role="treeitem"
          aria-level={ariaLevel}
          aria-label={`${item.name} ${itemLabel}`}
          aria-describedby={
            isTableItem && "row_count" in item
              ? `${row.key}-rowcount`
              : undefined
          }
          aria-selected={isHighlighted}
          {...rovingProps(ctx, row.key)}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          onKeyDown={(e) => {
            // #1142 — activation-key parity with schema/category rows (Enter+Space).
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleClick();
            } else if (e.key === "F2" && isTableItem) {
              e.preventDefault();
              ctx.handleStartRename(item.name, row.schemaName);
            }
          }}
        >
          {/* #1140 — keep the identifying aria-label (203 test queries depend on
              it) but expose the row-count to SR via aria-describedby so it is
              announced after the name instead of being masked by the override.
              Decorative type icon is aria-hidden. */}
          {icon}
          <span className="truncate text-sm">{item.name}</span>
          {isTableItem && "row_count" in item && (
            <span
              id={`${row.key}-rowcount`}
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
              <Columns3 size={14} /> {ctx.t("structure")}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleTableClick(item.name, row.schemaName)}
            >
              <Table2 size={14} /> {ctx.t("data")}
            </ContextMenuItem>
            {/* Sprint 275 — trigger entries removed from the Table row
                context menu. Trigger CRUD now lives entirely on the
                StructurePanel Triggers tab (consolidated single entry
                point). Column/Index/Constraint surfaces don't carry
                table-row shortcuts either, so this restores consistency. */}
            {supportsMigrationExport(ctx.dbType) && (
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <Download size={14} /> {ctx.t("exportTableMenu")}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {EXPORT_MODES.map(({ include, labelKey, Icon }) => (
                    <ContextMenuItem
                      key={include}
                      onClick={() =>
                        ctx.handleExportTable(
                          item.name,
                          row.schemaName,
                          include,
                        )
                      }
                    >
                      <Icon size={14} /> {ctx.t(labelKey)}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuItem
              onClick={() => ctx.handleTogglePin(item.name, row.schemaName)}
            >
              {ctx.isTablePinned(item.name, row.schemaName) ? (
                <>
                  <PinOff size={14} /> {ctx.t("unpinTable")}
                </>
              ) : (
                <>
                  <Pin size={14} /> {ctx.t("pinTable")}
                </>
              )}
            </ContextMenuItem>
            {ctx.canMutateSchema && (
              <>
                <ContextMenuItem
                  onClick={() =>
                    ctx.handleStartRename(item.name, row.schemaName)
                  }
                >
                  <Pencil size={14} /> {ctx.t("rename")}
                </ContextMenuItem>
                <ContextMenuItem
                  danger
                  onClick={() => ctx.handleDropTable(item.name, row.schemaName)}
                >
                  <Trash2 size={14} /> {ctx.t("drop")}
                </ContextMenuItem>
              </>
            )}
          </>
        ) : isView ? (
          <>
            <ContextMenuItem
              onClick={() =>
                ctx.handleOpenViewStructure(item.name, row.schemaName)
              }
            >
              <Columns3 size={14} /> {ctx.t("structure")}
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => ctx.handleViewClick(item.name, row.schemaName)}
            >
              <Table2 size={14} /> {ctx.t("data")}
            </ContextMenuItem>
          </>
        ) : (
          <ContextMenuItem
            onClick={() => ctx.handleFunctionClick(item.name, row.schemaName)}
          >
            <Code2 size={14} /> {ctx.t("viewSource")}
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
          {ctx.t("loadingTables")}
        </div>
      );
    case "category":
      return renderCategoryRow(row, ctx);
    case "search":
      return renderSearchRow(row, ctx);
    case "empty":
      return renderEmptyRow(row, ctx);
    case "item":
      return renderItemRow(row, ctx);
  }
}
