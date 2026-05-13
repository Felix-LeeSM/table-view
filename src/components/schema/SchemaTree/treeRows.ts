import type {
  TableInfo,
  TriggerInfo,
  ViewInfo,
  FunctionInfo,
} from "@/types/schema";
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
 * DBMS-aware label for the sidebar row-count cell. PG/MySQL report
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
  // null on PG/MySQL when ANALYZE hasn't run yet. Avoid promising a
  // count we don't have.
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
 * Visible row-count text:
 *   - `?` when unknown (SQLite always; PG/MySQL when null)
 *   - `~12,345` for PG/MySQL estimates — the tilde flags "estimate" at a
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
  | { type: "function"; schema: string; functionName: string }
  /**
   * Sprint 272 — per-trigger NodeId. Triggers live under a Table (not a
   * schema/category) so the discriminator carries both `table` and
   * `triggerName`. Sprint 273/274 will add explicit Create / Drop opener
   * paths that key off this variant.
   */
  | {
      type: "trigger";
      schema: string;
      table: string;
      triggerName: string;
    }
  /**
   * Sprint 272 — per-Table "Triggers" group header NodeId. Used to key
   * the expansion state for the trigger child group under a Table row.
   * Pattern mirrors `category` (which keys schema-level groups).
   */
  | {
      type: "triggerGroup";
      schema: string;
      table: string;
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
    case "trigger":
      return `trigger:${id.schema}:${id.table}:${id.triggerName}`;
    case "triggerGroup":
      return `triggerGroup:${id.schema}:${id.table}`;
  }
}

/**
 * Sprint 272 — stable string key for the `(schema, table)` pair used as
 * the trigger-group / per-table expansion key. Kept as a separate helper
 * so callers (`useSchemaTreeActions`, `body.tsx`, tests) can mint the
 * key without re-deriving the format. `:` separator matches the rest of
 * `nodeIdToString`.
 */
export function triggerGroupKey(schema: string, table: string): string {
  return `${schema}:${table}`;
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
    }
  /**
   * Sprint 272 — per-Table "Triggers (N)" group header row. Appears
   * directly under each Table row when the Table is expanded. Renders
   * with the same indent and chevron affordance as `category` rows
   * (one level deeper to match the Table → child relationship).
   *
   * `triggerCount` is `null` when triggers have not yet been fetched
   * (so the renderer can omit the count badge); a number once the cache
   * has resolved. `isLoading` / `error` are surfaced so the renderer
   * can show italic placeholder children at the next indent level.
   */
  | {
      kind: "trigger-group";
      key: string;
      schemaName: string;
      tableName: string;
      isExpanded: boolean;
      isSelected: boolean;
      isLoading: boolean;
      triggerCount: number | null;
      error: string | null;
    }
  /**
   * Sprint 272 — italic "Loading triggers…" placeholder under a
   * Triggers group while the cache miss is in flight.
   */
  | {
      kind: "trigger-loading";
      key: string;
      schemaName: string;
      tableName: string;
    }
  /**
   * Sprint 272 — italic "No triggers" placeholder under a Triggers
   * group once the fetch has settled to an empty array. Matches the
   * Functions/Views empty-state treatment.
   */
  | {
      kind: "trigger-empty";
      key: string;
      schemaName: string;
      tableName: string;
    }
  /**
   * Sprint 272 — italic red "Failed to load triggers" row with a
   * retry affordance. Mirrors the Functions error-row treatment.
   */
  | {
      kind: "trigger-error";
      key: string;
      schemaName: string;
      tableName: string;
      message: string;
    }
  /**
   * Sprint 272 — individual trigger row under an expanded Triggers
   * group. Right-click exposes the per-trigger context menu (Sprint
   * 273/274 affordances). `isSelected` follows the standard sidebar
   * selection model so the row highlights when keyboard-focused.
   */
  | {
      kind: "trigger-item";
      key: string;
      schemaName: string;
      tableName: string;
      trigger: TriggerInfo;
      isSelected: boolean;
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
  /**
   * Sprint 272 — per-Table expansion state for the Triggers child
   * group. Set of `triggerGroupKey(schema, table)` strings. Absent key
   * = collapsed. Triggers do NOT auto-expand on Table expansion (the
   * lazy fetch only fires when the user explicitly opens the group).
   */
  expandedTriggerGroups?: Set<string>;
  /**
   * Sprint 272 — pre-sliced per-`(connId, db)` trigger cache keyed by
   * `[schema][table]`. Undefined = "not yet fetched" so the renderer
   * shows a Loading placeholder; empty array = fetched + empty.
   */
  triggersBySchemaTable?: Record<string, Record<string, TriggerInfo[]>>;
  /**
   * Sprint 272 — set of `triggerGroupKey(schema, table)` strings that
   * are currently mid-flight (the lazy IPC has been dispatched, not
   * yet settled). Drives the "Loading triggers…" placeholder.
   */
  loadingTriggerGroups?: ReadonlySet<string>;
  /**
   * Sprint 272 — per-Table trigger fetch error message. Drives the
   * italic red "Failed to load triggers" row + retry affordance.
   */
  triggerErrors?: Record<string, string>;
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
  expandedTriggerGroups,
  triggersBySchemaTable,
  loadingTriggerGroups,
  triggerErrors,
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

        // Sprint 272 — emit the Triggers child group + (when expanded)
        // its per-trigger rows directly under each Table row. Views /
        // Functions do NOT carry trigger affordances (per master spec
        // § 2 — trigger management is table-scoped).
        if (itemKind === "table") {
          const triggerRows = buildTriggerRowsForTable({
            schemaName: schema.name,
            tableName: item.name,
            selectedNodeId,
            expandedTriggerGroups,
            triggersBySchemaTable,
            loadingTriggerGroups,
            triggerErrors,
          });
          for (const trigRow of triggerRows) {
            rows.push(trigRow);
          }
        }
      }
    }
  });

  return rows;
}

interface BuildTriggerRowsForTableArgs {
  schemaName: string;
  tableName: string;
  selectedNodeId: string | null;
  expandedTriggerGroups?: Set<string>;
  triggersBySchemaTable?: Record<string, Record<string, TriggerInfo[]>>;
  loadingTriggerGroups?: ReadonlySet<string>;
  triggerErrors?: Record<string, string>;
}

/**
 * Sprint 272 — build the Triggers child group header + (when expanded)
 * the placeholder/individual trigger rows for a single Table.
 *
 * The group header is ALWAYS emitted under an expanded Table row so the
 * affordance is discoverable without the user having to right-click.
 * When the group itself is collapsed (`expandedTriggerGroups` does NOT
 * carry the key) we stop there — no fetch is triggered (the lazy IPC is
 * gated by the group expansion, not the table expansion). When the
 * group is expanded the renderer emits one of:
 *   - `trigger-loading` while the IPC is in flight.
 *   - `trigger-error` if the fetch rejected (with a Retry affordance).
 *   - `trigger-empty` if the fetch settled with `triggers.length === 0`.
 *   - one `trigger-item` row per `TriggerInfo` otherwise.
 */
function buildTriggerRowsForTable({
  schemaName,
  tableName,
  selectedNodeId,
  expandedTriggerGroups,
  triggersBySchemaTable,
  loadingTriggerGroups,
  triggerErrors,
}: BuildTriggerRowsForTableArgs): VisibleRow[] {
  const out: VisibleRow[] = [];
  const groupKey = triggerGroupKey(schemaName, tableName);
  const groupNodeId = nodeIdToString({
    type: "triggerGroup",
    schema: schemaName,
    table: tableName,
  });
  const isExpanded = expandedTriggerGroups?.has(groupKey) ?? false;
  const isLoading = loadingTriggerGroups?.has(groupKey) ?? false;
  const error = triggerErrors?.[groupKey] ?? null;
  const triggersForTable =
    triggersBySchemaTable?.[schemaName]?.[tableName] ?? null;
  const triggerCount = triggersForTable?.length ?? null;

  out.push({
    kind: "trigger-group",
    key: `trigger-group:${schemaName}:${tableName}`,
    schemaName,
    tableName,
    isExpanded,
    isSelected: selectedNodeId === groupNodeId,
    isLoading,
    triggerCount,
    error,
  });

  if (!isExpanded) return out;

  if (isLoading && !triggersForTable) {
    out.push({
      kind: "trigger-loading",
      key: `trigger-loading:${schemaName}:${tableName}`,
      schemaName,
      tableName,
    });
    return out;
  }

  if (error) {
    out.push({
      kind: "trigger-error",
      key: `trigger-error:${schemaName}:${tableName}`,
      schemaName,
      tableName,
      message: error,
    });
    return out;
  }

  if (!triggersForTable) {
    // Not yet fetched and not currently loading — should be transient.
    // Render the same Loading placeholder so the row never reads as
    // empty before the IPC has had a chance to dispatch.
    out.push({
      kind: "trigger-loading",
      key: `trigger-loading:${schemaName}:${tableName}`,
      schemaName,
      tableName,
    });
    return out;
  }

  if (triggersForTable.length === 0) {
    out.push({
      kind: "trigger-empty",
      key: `trigger-empty:${schemaName}:${tableName}`,
      schemaName,
      tableName,
    });
    return out;
  }

  for (const trig of triggersForTable) {
    const trigNodeId = nodeIdToString({
      type: "trigger",
      schema: schemaName,
      table: tableName,
      triggerName: trig.name,
    });
    out.push({
      kind: "trigger-item",
      key: `trigger-item:${schemaName}:${tableName}:${trig.name}`,
      schemaName,
      tableName,
      trigger: trig,
      isSelected: selectedNodeId === trigNodeId,
    });
  }
  return out;
}
