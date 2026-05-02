import type { VirtualItem, Virtualizer } from "@tanstack/react-virtual";
import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
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
  renderItemRow,
  renderSchemaRow,
  renderSearchRow,
  renderVisibleRow,
  type SchemaTreeRowsContext,
} from "./rows";

/**
 * Sprint 199 — eager nested vs virtualized 분기. 두 분기 모두 `rows.tsx`
 * 의 leaf renderer 만 호출 → threshold 위/아래 cell DOM 동등 (Sprint 115
 * 회귀 가드).
 *
 * eager 분기는 wrapping `<div>` 3 종 (per-schema, per-category,
 * function/procedure overflow-cap) 을 byte-for-byte 보존 — pre-split
 * SchemaTree.tsx (lines 1384-1999) 의 SchemaTree.test.tsx 100+ 케이스가
 * 그 wrapping 에 의존.
 *
 * SQLite (`flat` shape) 는 category cascade 를 skip 하고 table 만 단일
 * 레벨로 렌더 — `renderItemRow(row, ctx, true)` 의 flat=true 모드.
 */

interface SchemaTreeBodyProps {
  schemas: ReadonlyArray<{ name: string }>;
  treeShape: RdbTreeShape;
  expandedSchemas: Set<string>;
  loadingTables: ReadonlySet<string>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
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
  // Sprint-115 — virtualizer reports total scroll height + windowed items.
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
    connectionId,
    selectedNodeId,
    ctx,
  } = props;

  const isExpanded =
    treeShape === "with-schema" ? expandedSchemas.has(schema.name) : true; // Sprint 135 — MySQL/SQLite 의 schema row 는 hidden 이지만
  // 내부적으로는 implicit "open" 으로 categories/tables 가 표시.
  const tableKey = `${connectionId}:${schema.name}`;
  const schemaTables: TableInfo[] = tables[tableKey] ?? [];
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

  if (schemaTables.length === 0) {
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
  connectionId,
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

  const schemaKey = `${connectionId}:${schema.name}`;
  const schemaViews: ViewInfo[] = views[schemaKey] ?? [];
  const schemaFunctions: FunctionInfo[] = functions[schemaKey] ?? [];

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
        // Sprint 136 (AC-S136-05) — function/procedure 카테고리는
        // `max-h-[50vh] overflow-y-auto` 로 cap. 다른 카테고리 / schema
        // row 가 viewport 밖으로 밀리지 않도록.
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
            : items.map((item) =>
                renderItemRow(
                  buildItemRow(item, schemaName, cat.key, itemKind, {
                    selectedNodeId,
                    activeSchema,
                    activeTable,
                  }),
                  ctx,
                ),
              )}
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
  const procs = functions.filter((f) => f.kind === "procedure");
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
    isActive:
      itemKind === "table" &&
      selection.activeSchema === schemaName &&
      selection.activeTable === item.name,
  };
}
