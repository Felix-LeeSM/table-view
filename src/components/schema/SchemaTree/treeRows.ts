import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
import {
  LayoutGrid,
  Eye,
  Code2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/**
 * Pure helper module for `SchemaTree`. No React or store imports — only
 * functions + types consumed by `rows.tsx` / `useSchemaTreeActions.ts` /
 * `SchemaTree.tsx`:
 *   - `getVisibleRows` flattens nested expansion state to the
 *     virtualizer's flat row list.
 *   - `rowCountLabel` / `rowCountText` produce the DBMS-aware row-count
 *     label and visible text.
 *   - `nodeIdToString` returns a stable string key for the `NodeId`
 *     discriminated union.
 */

/**
 * DBMS-aware label for the sidebar row-count cell. PG/MySQL/MariaDB report
 * estimates (`pg_class.reltuples`, `information_schema.tables.TABLE_ROWS`);
 * SQLite reports an exact COUNT(*) since it has no estimate catalog and
 * the file-local count is fast enough. Both `aria-label` (screen readers)
 * and `title` (hover tooltip) read this string.
 */
export function rowCountLabel(
  dbType: string | undefined,
  rowCount: number | null | undefined,
): string {
  // SQLite reports the exact count synchronously, but `rowCount` may be
  // null on PG/MySQL/MariaDB when ANALYZE hasn't run yet. Avoid promising a
  // count we don't have.
  if (dbType === "sqlite" || rowCount == null) {
    return "Exact row count not yet fetched";
  }
  if (dbType === "postgresql") {
    return "Estimated row count from pg_class.reltuples";
  }
  if (dbType === "mysql" || dbType === "mariadb") {
    return "Estimated row count from information_schema.tables";
  }
  return "Estimated row count";
}

/**
 * Visible row-count text:
 *   - `?` when unknown (SQLite always; PG/MySQL/MariaDB when null)
 *   - `~12,345` for PG/MySQL/MariaDB estimates — the tilde flags "estimate" at a
 *     glance so the user can tell it apart from an exact count.
 */
export function rowCountText(
  dbType: string | undefined,
  rowCount: number | null | undefined,
): string {
  if (dbType === "sqlite" || rowCount == null) {
    return "?";
  }
  return `~${rowCount.toLocaleString()}`;
}

/** Category definitions for schema objects. */
export const CATEGORIES = [
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
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  Icon: LucideIcon;
  emptyLabel: string;
}>;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Category = (typeof CATEGORIES)[number];

/** Unique identifier for a selectable tree node. */
export type NodeId =
  | { type: "schema"; schema: string }
  | { type: "category"; schema: string; category: CategoryKey }
  | { type: "table"; schema: string; table: string }
  | { type: "view"; schema: string; view: string }
  | { type: "function"; schema: string; functionName: string };

export function nodeIdToString(id: NodeId): string {
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
export const DEFAULT_EXPANDED = new Set<CategoryKey>(["tables"]);

/**
 * Above this row count, `<tbody>` rendering is handed off to
 * `useVirtualizer`. Below it we keep the eager nested layout so the
 * existing tests (fixtures under 200 rows) assert against full DOM
 * without virtualization spacers.
 */
export const VIRTUALIZE_THRESHOLD = 200;

/**
 * Estimated row height for the virtualizer. Schema/category/item rows
 * render ~22-26px; we round up to 26 for slightly conservative overscan.
 * `react-virtual` measures actual DOM after first paint, so this only
 * governs initial layout.
 */
export const ROW_HEIGHT_ESTIMATE = 26;

/**
 * Flat row representation produced by `getVisibleRows`. Each variant
 * carries enough information for the virtualizer path to render the same
 * cell as the eager-nested path:
 *   - `schema-separator` — hairline divider between sibling schemas.
 *   - `loading` / `empty` / `search` — placeholder rows (spinner, "no
 *     tables" copy, filter input) so virtualized datasets still surface
 *     the affordances the eager path provides.
 */
export type VisibleRow =
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
      category: Category;
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
      category: Category;
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

export interface BuildVisibleRowsArgs {
  schemas: ReadonlyArray<{ name: string }>;
  expandedSchemas: Set<string>;
  expandedCategories: Record<string, Set<CategoryKey>>;
  loadingTables: ReadonlySet<string>;
  // Sprint 263 — per-`(connId, db)` schema slice already sliced by the
  // caller. Keys are bare schema names; no `connId:` prefix.
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
 * Flatten the currently-expanded portion of the schema tree so
 * `useVirtualizer` can window over it. Order mirrors the eager nested
 * render exactly — separator → schema row → categories → search input →
 * items / empty — and tests assert against that ordering when the
 * virtualized path is active.
 */
export function getVisibleRows({
  schemas,
  expandedSchemas,
  expandedCategories,
  loadingTables,
  tables,
  views,
  functions,
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
    const schemaTables: TableInfo[] = tables[schema.name] ?? [];

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

      const schemaViews: ViewInfo[] = views[schema.name] ?? [];
      const schemaFunctions: FunctionInfo[] = functions[schema.name] ?? [];

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
          // 2026-05-11 — views open as table-type tabs (same `schema`/
          // `table` shape, just `objectKind: "view"`), so the view row
          // should also light up when its tab is active. Functions open
          // as query tabs and don't participate.
          isActive:
            (itemKind === "table" || itemKind === "view") &&
            activeSchema === schema.name &&
            activeTable === item.name,
        });
      }
    }
  });

  return rows;
}
