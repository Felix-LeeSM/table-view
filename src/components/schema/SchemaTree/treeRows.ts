import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
import {
  LayoutGrid,
  Eye,
  Code2,
  Terminal,
  type LucideIcon,
} from "lucide-react";

/**
 * Sprint 199 — pure helper module extracted from `SchemaTree.tsx` (Sprint 197
 * mongodb.rs entry-pattern 답습 — `SchemaTree.tsx` 가 entry 로 남고 본 파일은
 * 하위 sub-module). React import 0 / store import 0 — 순수 함수 + types
 * 만 export 한다.
 *
 * 책임:
 *   * `getVisibleRows` — schema/category/item nested state 를 flat
 *     `VisibleRow[]` 로 펼친다 (Sprint 115 virtualization 입력).
 *   * `rowCountLabel` / `rowCountText` — DBMS-aware 행수 라벨 (Sprint 143).
 *   * `nodeIdToString` — `NodeId` discriminated union 의 stable string key.
 *   * `CATEGORIES` / `DEFAULT_EXPANDED` / 관련 types — `rows.tsx` /
 *     `useSchemaTreeActions.ts` / `SchemaTree.tsx` 가 import.
 */

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
export function rowCountLabel(
  dbType: string | undefined,
  rowCount: number | null | undefined,
): string {
  // Sprint 143 (AC-148-2) — SQLite has no estimate catalog and PG/MySQL
  // can return null when ANALYZE hasn't run yet. In both cases we render
  // `?` and the long-form copy must reflect that the value isn't known
  // yet (rather than falsely promising an exact count or estimate).
  if (dbType === "sqlite" || rowCount == null) {
    return "Exact row count not yet fetched";
  }
  if (dbType === "postgresql") {
    return "Estimated row count from pg_class.reltuples";
  }
  if (dbType === "mysql") {
    return "Estimated row count from information_schema.tables";
  }
  return "Estimated row count";
}

/**
 * Sprint 143 (AC-148-1, AC-148-2) — visible row-count text:
 * - `?` when the value is unknown (SQLite always; PG/MySQL when null)
 * - `~12,345` for PG/MySQL non-null estimates (tilde flags it as an
 *   estimate at a glance)
 *
 * The lazy exact-count fetch (AC-148-3, deferred) will eventually
 * replace `~N` / `?` with a bare `N` once the cache hit lands.
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
 * Sprint-115 (#PERF-2, #TREE-4) — when the flattened "visible rows" list grows
 * past this threshold we hand `<tbody>` rendering off to `useVirtualizer` so
 * the DOM only carries a viewport-sized slice of rows. Below the threshold we
 * keep the eager nested layout, which means the 100 existing SchemaTree tests
 * (whose fixtures are all well under 200 rows) continue to assert against full
 * DOM output without virtualization spacers and with zero behavioral drift.
 */
export const VIRTUALIZE_THRESHOLD = 200;

/**
 * Sprint-115 — estimated row height for the virtualizer. Schema, category, and
 * item rows all use compact text (`text-2xs` / `text-xs` with `py-0.5` / `py-1`)
 * which renders ~22-26px. We round up to 26 to keep overscan slightly
 * conservative; `react-virtual` measures actual DOM after first paint, so the
 * estimate only governs initial layout.
 */
export const ROW_HEIGHT_ESTIMATE = 26;

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
export function getVisibleRows({
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
