import type { TableInfo, ViewInfo, FunctionInfo } from "@/types/schema";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";
import type { RdbTreeShape } from "../treeShape";
import {
  LayoutGrid,
  Eye,
  Code2,
  Terminal,
  ListOrdered,
  Link2,
  type LucideIcon,
} from "lucide-react";
import i18n from "@lib/i18n";

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
 * the file-local count is fast enough (backend
 * `sqlite/connection.rs::list_tables` sends `row_count: Some(COUNT(*))`).
 * Both `aria-label` (screen readers) and `title` (hover tooltip) read this
 * string.
 */
export function rowCountLabel(
  dbType: string | undefined,
  rowCount: number | null | undefined,
): string {
  // `?` (unknown) only when we genuinely have no number — null on
  // PG/MySQL/MariaDB when ANALYZE hasn't run, or a failed catalog query.
  if (rowCount == null) {
    return i18n.t("schema:rowCountUnknown");
  }
  if (dbType === "sqlite") {
    return i18n.t("schema:rowCountExact");
  }
  if (dbType === "postgresql") {
    return i18n.t("schema:rowCountPg");
  }
  if (dbType === "mysql" || dbType === "mariadb") {
    return i18n.t("schema:rowCountMysql");
  }
  return i18n.t("schema:rowCountEstimated");
}

/**
 * Visible row-count text:
 *   - `?` when unknown (any DBMS when `rowCount == null`)
 *   - `12,345` for SQLite — an exact COUNT(*), shown bare (no tilde)
 *   - `~12,345` for PG/MySQL/MariaDB estimates — the tilde flags "estimate"
 *     at a glance so the user can tell it apart from an exact count.
 */
export function rowCountText(
  dbType: string | undefined,
  rowCount: number | null | undefined,
): string {
  if (rowCount == null) {
    return "?";
  }
  const formatted = rowCount.toLocaleString();
  return dbType === "sqlite" ? formatted : `~${formatted}`;
}

/** Category definitions for schema objects. */
export const CATEGORIES = [
  {
    key: "tables",
    label: "Tables",
    Icon: LayoutGrid,
    emptyLabel: "No tables",
    labelKey: "categoryTables",
    emptyLabelKey: "emptyTables",
  },
  {
    key: "views",
    label: "Views",
    Icon: Eye,
    emptyLabel: "No views",
    labelKey: "categoryViews",
    emptyLabelKey: "emptyViews",
  },
  {
    key: "functions",
    label: "Functions",
    Icon: Code2,
    emptyLabel: "No functions",
    labelKey: "categoryFunctions",
    emptyLabelKey: "emptyFunctions",
  },
  {
    key: "procedures",
    label: "Procedures",
    Icon: Terminal,
    emptyLabel: "No procedures",
    labelKey: "categoryProcedures",
    emptyLabelKey: "emptyProcedures",
  },
  {
    key: "sequences",
    label: "Sequences",
    Icon: ListOrdered,
    emptyLabel: "No sequences",
    labelKey: "categorySequences",
    emptyLabelKey: "emptySequences",
  },
  {
    key: "synonyms",
    label: "Synonyms",
    Icon: Link2,
    emptyLabel: "No synonyms",
    labelKey: "categorySynonyms",
    emptyLabelKey: "emptySynonyms",
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  Icon: LucideIcon;
  emptyLabel: string;
  labelKey: string;
  emptyLabelKey: string;
}>;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type Category = (typeof CATEGORIES)[number];

/** Unique identifier for a selectable tree node. */
export type NodeId =
  | { type: "schema"; schema: string }
  | { type: "category"; schema: string; category: CategoryKey }
  | { type: "table"; schema: string; table: string }
  | { type: "view"; schema: string; view: string }
  | { type: "function"; schema: string; functionName: string }
  | {
      type: "object";
      schema: string;
      category: CategoryKey;
      objectName: string;
    };

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
    case "object":
      return `object:${id.schema}:${id.category}:${id.objectName}`;
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
      // #1217 — count of tables currently in view for this schema (the
      // full count normally, or the filtered count during a global
      // filter). Rendered as a badge so a collapsed schema still gives an
      // at-a-glance overview.
      tableCount: number;
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
      itemKind: "table" | "view" | "function" | "metadata";
      isSelected: boolean;
      isActive: boolean;
    }
  // #1445 — DuckDB (flat shape) registered file sources, so the flat
  // virtualized path surfaces them like the eager `FlatTableList` does.
  | { kind: "file-source-header"; key: string }
  | {
      kind: "file-source";
      key: string;
      metadata: FileAnalyticsSourceMetadata;
    };

export interface BuildVisibleRowsArgs {
  schemas: ReadonlyArray<{ name: string }>;
  // #1445 — the flat row list must mirror the shape-specific eager render so
  // flat (SQLite/DuckDB) and no-schema (MySQL) trees virtualize by count too.
  // `with-schema` keeps the schema row + separator; `no-schema` suppresses
  // both and force-expands its single implicit schema; `flat` additionally
  // drops the category cascade, rendering tables (and DuckDB file sources)
  // directly. Defaults to `with-schema` so existing callers/tests are
  // unaffected.
  treeShape?: RdbTreeShape;
  // #1445 — DuckDB registered file sources, appended after the flat table
  // list (mirrors `FlatTableList`). Ignored for non-flat shapes.
  fileAnalyticsSources?: ReadonlyArray<FileAnalyticsSourceMetadata>;
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
  // #1217 — when the top-level global filter is active the caller has
  // already narrowed `schemas` / `tables` / `views` / `functions` to the
  // matches and forced the matching schemas expanded. This flag tells the
  // builder to (a) skip the per-schema search input, (b) hide categories
  // with no matches, and (c) force the surviving categories open so the
  // matches are visible — filter visibility overrides the collapse rule.
  globalFilterActive?: boolean;
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
  treeShape = "with-schema",
  fileAnalyticsSources = [],
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
  globalFilterActive = false,
}: BuildVisibleRowsArgs): VisibleRow[] {
  const rows: VisibleRow[] = [];

  schemas.forEach((schema, schemaIndex) => {
    const schemaTables: TableInfo[] = tables[schema.name] ?? [];
    const isLoadingTables = loadingTables.has(schema.name);

    // #1445 flat (SQLite/DuckDB) — no schema row, no categories; tables
    // render directly under the root, followed by DuckDB file sources.
    // Mirrors the eager `FlatTableList`.
    if (treeShape === "flat") {
      if (isLoadingTables && schemaTables.length === 0) {
        rows.push({
          kind: "loading",
          key: `loading:${schema.name}`,
          schemaName: schema.name,
        });
        return;
      }
      if (schemaTables.length === 0) {
        rows.push({
          kind: "empty",
          key: `empty:${schema.name}:tables`,
          schemaName: schema.name,
          category: CATEGORIES[0],
          hasActiveSearch: false,
        });
      }
      for (const item of schemaTables) {
        const itemId = nodeIdToString({
          type: "table",
          schema: schema.name,
          table: item.name,
        });
        rows.push({
          kind: "item",
          key: `flat-${item.name}`,
          schemaName: schema.name,
          categoryKey: "tables",
          item,
          itemKind: "table",
          isSelected: selectedNodeId === itemId,
          isActive: activeSchema === schema.name && activeTable === item.name,
        });
      }
      if (fileAnalyticsSources.length > 0) {
        rows.push({ kind: "file-source-header", key: "file-sources-header" });
        for (const metadata of fileAnalyticsSources) {
          rows.push({
            kind: "file-source",
            key: `file-source-${metadata.source.id}`,
            metadata,
          });
        }
      }
      return;
    }

    // #1445 no-schema (MySQL/MariaDB) — suppress the schema row + separator
    // and force the single implicit schema expanded; the category cascade
    // below is otherwise identical to with-schema.
    const isNoSchema = treeShape === "no-schema";
    if (!isNoSchema) {
      if (schemaIndex > 0) {
        rows.push({ kind: "schema-separator", key: `sep:${schema.name}` });
      }
      const schemaId = nodeIdToString({ type: "schema", schema: schema.name });
      rows.push({
        kind: "schema",
        key: schemaId,
        schemaName: schema.name,
        isExpanded: expandedSchemas.has(schema.name),
        isLoadingTables,
        isSelected: selectedNodeId === schemaId,
        tableCount: schemaTables.length,
      });
    }

    const isExpanded = isNoSchema ? true : expandedSchemas.has(schema.name);
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
      const isSequenceCat = cat.key === "sequences";
      const isSynonymCat = cat.key === "synonyms";

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
                ? schemaFunctions.filter(
                    (f) => f.kind === "procedure" || f.kind === "package",
                  )
                : isSequenceCat
                  ? schemaFunctions.filter((f) => f.kind === "sequence")
                  : isSynonymCat
                    ? schemaFunctions.filter((f) => f.kind === "synonym")
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

      // #1217 — during a global filter, drop categories with no matches and
      // force the surviving ones open so the matches are always visible.
      if (globalFilterActive && items.length === 0) continue;
      const catExpanded = globalFilterActive ? true : expanded.has(cat.key);

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

      if (isTableCat && unfilteredItems.length > 0 && !globalFilterActive) {
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
        const itemKind: "table" | "view" | "function" | "metadata" = isTableCat
          ? "table"
          : isViewCat
            ? "view"
            : isFunctionCat || isProcedureCat
              ? "function"
              : "metadata";
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
        const metadataItemId = nodeIdToString({
          type: "object",
          schema: schema.name,
          category: cat.key,
          objectName: item.name,
        });
        rows.push({
          kind: "item",
          key: `${cat.key}:${schema.name}:${item.name}`,
          schemaName: schema.name,
          categoryKey: cat.key,
          item,
          itemKind,
          isSelected:
            selectedNodeId ===
            (itemKind === "metadata" ? metadataItemId : itemId),
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

export interface FilteredTree {
  schemas: ReadonlyArray<{ name: string }>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
  // Schema names that survived the filter and should be force-expanded.
  // `null` when no filter is active (caller keeps its own expansion state).
  matchedSchemaNames: Set<string> | null;
}

interface FilterTreeInput {
  schemas: ReadonlyArray<{ name: string }>;
  tables: Record<string, TableInfo[]>;
  views: Record<string, ViewInfo[]>;
  functions: Record<string, FunctionInfo[]>;
}

/**
 * #1217 — global sidebar filter. Narrows the tree to schemas / objects whose
 * name contains `query` (case-insensitive). A schema is kept when its own
 * name matches (then all of its objects are shown) or when any of its
 * tables / views / functions match (then only the matching objects are
 * shown). `keepEmptySchemas` keeps a shape's single implicit schema even
 * when nothing matches, so no-schema (MySQL) / flat (SQLite) trees render a
 * "no matches" placeholder instead of a blank pane.
 *
 * When `query` is blank the inputs are returned by reference (no filtering,
 * `matchedSchemaNames = null`) so the caller's memoisation is undisturbed.
 */
export function applyGlobalFilter(
  query: string,
  keepEmptySchemas: boolean,
  input: FilterTreeInput,
): FilteredTree {
  const q = query.trim().toLowerCase();
  if (!q) {
    return {
      schemas: input.schemas,
      tables: input.tables,
      views: input.views,
      functions: input.functions,
      matchedSchemaNames: null,
    };
  }

  const matched = new Set<string>();
  const tables: Record<string, TableInfo[]> = {};
  const views: Record<string, ViewInfo[]> = {};
  const functions: Record<string, FunctionInfo[]> = {};
  const schemas: { name: string }[] = [];
  const byName = (item: { name: string }) =>
    item.name.toLowerCase().includes(q);

  for (const schema of input.schemas) {
    const name = schema.name;
    const schemaNameMatch = name.toLowerCase().includes(q);
    const allTables = input.tables[name] ?? [];
    const allViews = input.views[name] ?? [];
    const allFunctions = input.functions[name] ?? [];
    const t = schemaNameMatch ? allTables : allTables.filter(byName);
    const v = schemaNameMatch ? allViews : allViews.filter(byName);
    const f = schemaNameMatch ? allFunctions : allFunctions.filter(byName);
    const hasMatch =
      schemaNameMatch || t.length > 0 || v.length > 0 || f.length > 0;
    if (!hasMatch && !keepEmptySchemas) continue;
    matched.add(name);
    schemas.push(schema);
    tables[name] = t;
    views[name] = v;
    functions[name] = f;
  }

  return { schemas, tables, views, functions, matchedSchemaNames: matched };
}
