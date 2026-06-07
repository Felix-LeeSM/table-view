import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type { RdbTreeShape } from "../treeShape";
import {
  CATEGORIES,
  nodeIdToString,
  type Category,
  type CategoryKey,
  type VisibleRow,
} from "./treeRows";
import {
  renderCategoryRow,
  renderEmptyRow,
  renderFileAnalyticsSourceRow,
  renderItemRow,
  renderSchemaRow,
  renderSearchRow,
  renderVisibleRow,
  type SchemaTreeRowsContext,
} from "./rows";

/**
 * Eager-nested vs virtualized branch dispatch. Both call into
 * `rows.tsx`'s leaf renderer so the cell DOM stays identical above and
 * below the virtualization threshold. SQLite (`flat` shape) skips the
 * category cascade and renders tables at a single level.
 */

interface SchemaTreeBodyProps {
  schemas: ReadonlyArray<{ name: string }>;
  treeShape: RdbTreeShape;
  expandedSchemas: Set<string>;
  loadingTables: ReadonlySet<string>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  fileAnalyticsSources: ReadonlyArray<FileAnalyticsSourceMetadata>;
  connectionId: string;
  selectedNodeId: string | null;
  activeSchema: string | null;
  activeTable: string | null;
  tableSearch: Record<string, string>;
  visibleRows: VisibleRow[];
  shouldVirtualize: boolean;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  ctx: SchemaTreeRowsContext;
}

export function SchemaTreeBody(props: SchemaTreeBodyProps) {
  if (props.shouldVirtualize) return <VirtualizedBranch {...props} />;
  return <EagerBranch {...props} />;
}

function VirtualizedBranch({
  visibleRows,
  rowVirtualizer,
  ctx,
}: SchemaTreeBodyProps) {
  // Top/bottom `aria-hidden` spacers preserve scroll height while only
  // the windowed rows live in the DOM.
  const virtualItems: VirtualItem[] = rowVirtualizer.getVirtualItems();
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
            {renderVisibleRow(row, ctx)}
          </div>
        );
      })}
      {paddingBottom > 0 && (
        <div aria-hidden="true" style={{ height: paddingBottom }} />
      )}
    </div>
  );
}

function EagerBranch(props: SchemaTreeBodyProps) {
  return (
    <>
      {props.schemas.map((schema, schemaIndex) => (
        <SchemaSection
          key={schema.name}
          schema={schema}
          schemaIndex={schemaIndex}
          {...props}
        />
      ))}
    </>
  );
}

interface SchemaSectionProps extends SchemaTreeBodyProps {
  schema: { name: string };
  schemaIndex: number;
}

function SchemaSection(props: SchemaSectionProps) {
  const {
    schema,
    schemaIndex,
    treeShape,
    expandedSchemas,
    loadingTables,
    tables,
    selectedNodeId,
    ctx,
  } = props;

  // MySQL/SQLite hide the schema row but still need it implicitly
  // expanded so categories/tables render under the sidebar root.
  const isExpanded =
    treeShape === "with-schema" ? expandedSchemas.has(schema.name) : true;
  const schemaTables: TableInfo[] = tables[schema.name] ?? [];
  const isLoadingTables = loadingTables.has(schema.name);
  const schemaId = nodeIdToString({ type: "schema", schema: schema.name });
  const isSchemaSelected = selectedNodeId === schemaId;

  return (
    <div>
      {treeShape === "with-schema" && schemaIndex > 0 && (
        <div className="mx-3 my-0.5 border-t border-border" />
      )}

      {treeShape === "with-schema" &&
        renderSchemaRow(
          {
            kind: "schema",
            key: schemaId,
            schemaName: schema.name,
            isExpanded,
            isLoadingTables,
            isSelected: isSchemaSelected,
          },
          ctx,
        )}

      {isExpanded && treeShape === "flat" && (
        <FlatTableList {...props} schemaTables={schemaTables} />
      )}

      {isExpanded && treeShape !== "flat" && (
        <CategoryCascade
          {...props}
          schemaTables={schemaTables}
          isLoadingTables={isLoadingTables}
        />
      )}
    </div>
  );
}

interface FlatTableListProps extends SchemaSectionProps {
  schemaTables: TableInfo[];
}

function FlatTableList({
  schema,
  schemaTables,
  fileAnalyticsSources,
  loadingTables,
  selectedNodeId,
  activeSchema,
  activeTable,
  ctx,
}: FlatTableListProps) {
  const isLoadingTables = loadingTables.has(schema.name);

  if (isLoadingTables && schemaTables.length === 0) {
    return (
      <div>
        <div className="px-3 py-1 text-xs text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  if (schemaTables.length === 0 && fileAnalyticsSources.length === 0) {
    return (
      <div>
        <div className="px-3 py-1 text-2xs italic text-muted-foreground">
          No tables
        </div>
      </div>
    );
  }

  return (
    <div>
      {schemaTables.length === 0 && (
        <div className="px-3 py-1 text-2xs italic text-muted-foreground">
          No tables
        </div>
      )}
      {schemaTables.map((item) => {
        const itemId = nodeIdToString({
          type: "table",
          schema: schema.name,
          table: item.name,
        });
        return renderItemRow(
          {
            kind: "item",
            key: `flat-${item.name}`,
            schemaName: schema.name,
            categoryKey: "tables",
            item,
            itemKind: "table",
            isSelected: selectedNodeId === itemId,
            isActive: activeSchema === schema.name && activeTable === item.name,
          },
          ctx,
          true, // flat=true → pl-3 + table-only ContextMenu 분기
        );
      })}
      {fileAnalyticsSources.length > 0 && (
        <>
          <div className="px-3 pt-2 pb-0.5 text-3xs font-medium uppercase text-muted-foreground">
            Local sources
          </div>
          {fileAnalyticsSources.map((source) =>
            renderFileAnalyticsSourceRow(source),
          )}
        </>
      )}
    </div>
  );
}

interface CategoryCascadeProps extends SchemaSectionProps {
  schemaTables: TableInfo[];
  isLoadingTables: boolean;
}

function CategoryCascade({
  schema,
  schemaTables,
  isLoadingTables,
  views,
  functions,
  selectedNodeId,
  activeSchema,
  activeTable,
  tableSearch,
  ctx,
}: CategoryCascadeProps) {
  if (isLoadingTables && schemaTables.length === 0) {
    return (
      <div>
        <div className="px-8 py-1 text-xs text-muted-foreground">
          Loading...
        </div>
      </div>
    );
  }

  const schemaViews: ViewInfo[] = views[schema.name] ?? [];
  const schemaFunctions: FunctionInfo[] = functions[schema.name] ?? [];

  return (
    <div>
      {CATEGORIES.map((cat) => (
        <CategorySection
          key={cat.key}
          cat={cat}
          schemaName={schema.name}
          schemaTables={schemaTables}
          schemaViews={schemaViews}
          schemaFunctions={schemaFunctions}
          selectedNodeId={selectedNodeId}
          activeSchema={activeSchema}
          activeTable={activeTable}
          tableSearch={tableSearch}
          ctx={ctx}
        />
      ))}
    </div>
  );
}

interface CategorySectionProps {
  cat: Category;
  schemaName: string;
  schemaTables: TableInfo[];
  schemaViews: ViewInfo[];
  schemaFunctions: FunctionInfo[];
  selectedNodeId: string | null;
  activeSchema: string | null;
  activeTable: string | null;
  tableSearch: Record<string, string>;
  ctx: SchemaTreeRowsContext;
}

function CategorySection({
  cat,
  schemaName,
  schemaTables,
  schemaViews,
  schemaFunctions,
  selectedNodeId,
  activeSchema,
  activeTable,
  tableSearch,
  ctx,
}: CategorySectionProps) {
  const catExpanded = ctx.isCategoryExpanded(schemaName, cat.key);
  const categoryId = nodeIdToString({
    type: "category",
    schema: schemaName,
    category: cat.key,
  });
  const { unfilteredItems, items, itemKind } = pickCategoryItems(cat.key, {
    tables: schemaTables,
    views: schemaViews,
    functions: schemaFunctions,
    searchValue: tableSearch[schemaName] ?? "",
  });

  return (
    <div>
      {renderCategoryRow(
        {
          kind: "category",
          key: categoryId,
          schemaName,
          category: cat,
          isExpanded: catExpanded,
          isSelected: selectedNodeId === categoryId,
          itemCount: items.length,
        },
        ctx,
      )}

      {catExpanded && (
        // Cap function/procedure lists at half the viewport so a schema
        // with hundreds of routines doesn't push other categories out.
        <div
          className={
            cat.key === "functions" || cat.key === "procedures"
              ? "max-h-[50vh] overflow-y-auto"
              : undefined
          }
          data-category-overflow={
            cat.key === "functions" || cat.key === "procedures"
              ? "capped"
              : undefined
          }
        >
          {cat.key === "tables" &&
            unfilteredItems.length > 0 &&
            renderSearchRow(
              {
                kind: "search",
                key: `search:${schemaName}`,
                schemaName,
                searchValue: tableSearch[schemaName] ?? "",
              },
              ctx,
            )}
          {items.length === 0
            ? renderEmptyRow({
                kind: "empty",
                key: `empty:${schemaName}:${cat.key}`,
                schemaName,
                category: cat,
                hasActiveSearch:
                  cat.key === "tables" && !!tableSearch[schemaName],
              })
            : items.map((item) => {
                const itemRow = buildItemRow(
                  item,
                  schemaName,
                  cat.key,
                  itemKind,
                  { selectedNodeId, activeSchema, activeTable },
                );
                return (
                  <div key={itemRow.key}>{renderItemRow(itemRow, ctx)}</div>
                );
              })}
        </div>
      )}
    </div>
  );
}

interface PickCategoryArgs {
  tables: TableInfo[];
  views: ViewInfo[];
  functions: FunctionInfo[];
  searchValue: string;
}

interface PickCategoryResult {
  unfilteredItems: (TableInfo | ViewInfo | FunctionInfo)[];
  items: (TableInfo | ViewInfo | FunctionInfo)[];
  itemKind: "table" | "view" | "function";
}

function pickCategoryItems(
  catKey: CategoryKey,
  { tables, views, functions, searchValue }: PickCategoryArgs,
): PickCategoryResult {
  if (catKey === "tables") {
    const lower = searchValue.toLowerCase();
    const filtered = lower
      ? tables.filter((t) => t.name.toLowerCase().includes(lower))
      : tables;
    return { unfilteredItems: tables, items: filtered, itemKind: "table" };
  }
  if (catKey === "views") {
    return { unfilteredItems: views, items: views, itemKind: "view" };
  }
  if (catKey === "functions") {
    const fns = functions.filter(
      (f) =>
        f.kind === "function" || f.kind === "aggregate" || f.kind === "window",
    );
    return { unfilteredItems: fns, items: fns, itemKind: "function" };
  }
  // procedures
  const procs = functions.filter(
    (f) => f.kind === "procedure" || f.kind === "package",
  );
  return { unfilteredItems: procs, items: procs, itemKind: "function" };
}

function buildItemRow(
  item: TableInfo | ViewInfo | FunctionInfo,
  schemaName: string,
  categoryKey: CategoryKey,
  itemKind: "table" | "view" | "function",
  selection: {
    selectedNodeId: string | null;
    activeSchema: string | null;
    activeTable: string | null;
  },
): Extract<VisibleRow, { kind: "item" }> {
  const itemId =
    itemKind === "table"
      ? nodeIdToString({
          type: "table",
          schema: schemaName,
          table: item.name,
        })
      : itemKind === "view"
        ? nodeIdToString({
            type: "view",
            schema: schemaName,
            view: item.name,
          })
        : nodeIdToString({
            type: "function",
            schema: schemaName,
            functionName: item.name,
          });
  return {
    kind: "item",
    key: `${categoryKey}-${item.name}`,
    schemaName,
    categoryKey,
    item,
    itemKind,
    isSelected: selection.selectedNodeId === itemId,
    // 2026-05-11 — views share the table-tab shape (same schema/table
    // fields, just `objectKind: "view"`), so they participate in the
    // active-tab highlight identically. Functions open as query tabs
    // and stay on the click-based `isSelected` path.
    isActive:
      (itemKind === "table" || itemKind === "view") &&
      selection.activeSchema === schemaName &&
      selection.activeTable === item.name,
  };
}
