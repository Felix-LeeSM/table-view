import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  RefreshCw,
  Loader2,
  Code2,
  Database,
  FolderOpen,
  Eye,
  LayoutGrid,
} from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import { useTabStore } from "../stores/tabStore";
import type { TableInfo } from "../types/schema";

const EMPTY_SCHEMAS: never[] = [];

/** Category definitions for schema objects. */
const CATEGORIES = [
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
    Icon: Code2,
    emptyLabel: "No procedures",
  },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

/** Unique identifier for a selectable tree node. */
type NodeId =
  | { type: "schema"; schema: string }
  | { type: "category"; schema: string; category: CategoryKey }
  | { type: "table"; schema: string; table: string };

function nodeIdToString(id: NodeId): string {
  switch (id.type) {
    case "schema":
      return `schema:${id.schema}`;
    case "category":
      return `category:${id.schema}:${id.category}`;
    case "table":
      return `table:${id.schema}:${id.table}`;
  }
}

/** Default expanded categories for a newly-opened schema. */
const DEFAULT_EXPANDED = new Set<CategoryKey>(["tables"]);

interface SchemaTreeProps {
  connectionId: string;
}

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]) ?? EMPTY_SCHEMAS;
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const addTab = useTabStore((s) => s.addTab);
  const addQueryTab = useTabStore((s) => s.addQueryTab);
  const tables = useSchemaStore((s) => s.tables);

  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [expandedCategories, setExpandedCategories] = useState<
    Record<string, Set<CategoryKey>>
  >({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
  const autoLoadedRef = useRef<string | null>(null);

  // Auto-load schemas on mount or when connectionId changes
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => handleRefresh();
    window.addEventListener("refresh-schema", handler);
    return () => window.removeEventListener("refresh-schema", handler);
  }, [connectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpandSchema = async (schemaName: string) => {
    const newExpanded = new Set(expandedSchemas);
    if (newExpanded.has(schemaName)) {
      newExpanded.delete(schemaName);
      setExpandedSchemas(newExpanded);
      return;
    }
    newExpanded.add(schemaName);
    setExpandedSchemas(newExpanded);

    const key = `${connectionId}:${schemaName}`;
    if (!tables[key]) {
      setLoadingTables((prev) => new Set(prev).add(schemaName));
      loadTables(connectionId, schemaName)
        .catch(() => {})
        .finally(() =>
          setLoadingTables((prev) => {
            const next = new Set(prev);
            next.delete(schemaName);
            return next;
          }),
        );
    }
  };

  const handleRefresh = () => {
    setLoadingSchemas(true);
    loadSchemas(connectionId)
      .catch(() => {})
      .finally(() => setLoadingSchemas(false));
  };

  const handleTableClick = (tableName: string, schemaName: string) => {
    setSelectedNodeId(
      nodeIdToString({ type: "table", schema: schemaName, table: tableName }),
    );
    addTab({
      title: `${schemaName}.${tableName}`,
      connectionId,
      type: "table",
      closable: true,
      schema: schemaName,
      table: tableName,
      subView: "records",
    });
  };

  const toggleCategory = (schemaName: string, categoryKey: CategoryKey) => {
    setExpandedCategories((prev) => {
      const current = prev[schemaName] ?? new Set(DEFAULT_EXPANDED);
      const next = new Set(current);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return { ...prev, [schemaName]: next };
    });
    setSelectedNodeId(
      nodeIdToString({
        type: "category",
        schema: schemaName,
        category: categoryKey,
      }),
    );
  };

  const isCategoryExpanded = (
    schemaName: string,
    key: CategoryKey,
  ): boolean => {
    const expanded = expandedCategories[schemaName] ?? DEFAULT_EXPANDED;
    return expanded.has(key);
  };

  return (
    <div className="flex flex-col">
      {/* Connection header with Database icon */}
      <div className="flex items-center gap-1.5 border-b border-(--color-border) px-3 py-1.5">
        <Database size={13} className="shrink-0 text-(--color-accent)" />
        <span className="truncate text-xs font-semibold text-(--color-text-primary)">
          {connectionId}
        </span>
        <div className="ml-auto flex gap-1">
          <button
            className="rounded p-0.5 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-secondary)"
            onClick={() => addQueryTab(connectionId)}
            aria-label="New Query"
            title="New Query"
          >
            <Code2 size={12} />
          </button>
          <button
            className="rounded p-0.5 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) hover:text-(--color-text-secondary)"
            onClick={handleRefresh}
            disabled={loadingSchemas}
            aria-label="Refresh schemas"
          >
            {loadingSchemas ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
          </button>
        </div>
      </div>

      {/* "Schemas" header label */}
      <div className="px-3 py-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-(--color-text-muted)">
          Schemas
        </span>
      </div>

      {schemas.map((schema, schemaIndex) => {
        const isExpanded = expandedSchemas.has(schema.name);
        const tableKey = `${connectionId}:${schema.name}`;
        const schemaTables: TableInfo[] = tables[tableKey] ?? [];
        const isLoadingTables = loadingTables.has(schema.name);
        const schemaId = nodeIdToString({
          type: "schema",
          schema: schema.name,
        });
        const isSchemaSelected = selectedNodeId === schemaId;

        return (
          <div key={schema.name}>
            {/* Section separator between schemas */}
            {schemaIndex > 0 && (
              <div className="mx-3 my-0.5 border-t border-(--color-border)" />
            )}

            {/* Schema row */}
            <div
              className={`flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium hover:bg-(--color-bg-tertiary) ${
                isSchemaSelected
                  ? "bg-(--color-bg-tertiary) text-(--color-text-primary)"
                  : "text-(--color-text-secondary)"
              }`}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${schema.name} schema`}
              onClick={() => {
                handleExpandSchema(schema.name);
                setSelectedNodeId(schemaId);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleExpandSchema(schema.name);
                  setSelectedNodeId(schemaId);
                }
              }}
            >
              {isExpanded ? (
                <ChevronDown size={12} className="shrink-0" />
              ) : (
                <ChevronRight size={12} className="shrink-0" />
              )}
              <FolderOpen
                size={13}
                className="shrink-0 text-(--color-text-muted)"
              />
              <span className="truncate">{schema.name}</span>
              {isLoadingTables && (
                <Loader2 size={10} className="ml-auto animate-spin" />
              )}
            </div>

            {/* Category sections under expanded schema */}
            {isExpanded && (
              <div>
                {isLoadingTables && schemaTables.length === 0 ? (
                  <div className="px-8 py-1 text-xs text-(--color-text-muted)">
                    Loading...
                  </div>
                ) : (
                  CATEGORIES.map((cat) => {
                    const catExpanded = isCategoryExpanded(
                      schema.name,
                      cat.key,
                    );
                    const categoryId = nodeIdToString({
                      type: "category",
                      schema: schema.name,
                      category: cat.key,
                    });
                    const isCatSelected = selectedNodeId === categoryId;

                    // For "tables" category, show actual tables. Others are empty.
                    const items: TableInfo[] =
                      cat.key === "tables" ? schemaTables : [];

                    return (
                      <div key={cat.key}>
                        {/* Category header */}
                        <div
                          className={`flex cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-6 text-[11px] font-medium hover:bg-(--color-bg-tertiary) ${
                            isCatSelected
                              ? "bg-(--color-bg-tertiary) text-(--color-text-primary)"
                              : "text-(--color-text-secondary)"
                          }`}
                          role="button"
                          tabIndex={0}
                          aria-expanded={catExpanded}
                          aria-label={`${cat.label} in ${schema.name}`}
                          onClick={() => toggleCategory(schema.name, cat.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleCategory(schema.name, cat.key);
                            }
                          }}
                        >
                          {catExpanded ? (
                            <ChevronDown size={11} className="shrink-0" />
                          ) : (
                            <ChevronRight size={11} className="shrink-0" />
                          )}
                          <cat.Icon
                            size={12}
                            className="shrink-0 text-(--color-text-muted)"
                          />
                          <span>{cat.label}</span>
                          {cat.key === "tables" && schemaTables.length > 0 && (
                            <span className="ml-auto text-[10px] text-(--color-text-muted)">
                              {schemaTables.length}
                            </span>
                          )}
                        </div>

                        {/* Category content */}
                        {catExpanded && (
                          <div>
                            {items.length === 0 ? (
                              <div className="px-10 py-1 text-[11px] italic text-(--color-text-muted)">
                                {cat.emptyLabel}
                              </div>
                            ) : (
                              items.map((item) => {
                                const tableId = nodeIdToString({
                                  type: "table",
                                  schema: schema.name,
                                  table: item.name,
                                });
                                const isTableSelected =
                                  selectedNodeId === tableId;

                                return (
                                  <div
                                    key={item.name}
                                    className={`flex cursor-pointer items-center gap-1.5 py-0.5 pr-3 pl-10 hover:bg-(--color-bg-tertiary) ${
                                      isTableSelected
                                        ? "bg-(--color-accent)/10 text-(--color-accent)"
                                        : "text-(--color-text-primary)"
                                    }`}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`${item.name} table`}
                                    onClick={() =>
                                      handleTableClick(item.name, schema.name)
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        handleTableClick(
                                          item.name,
                                          schema.name,
                                        );
                                      }
                                    }}
                                  >
                                    <Table2
                                      size={12}
                                      className="shrink-0 text-(--color-text-muted)"
                                    />
                                    <span className="truncate text-xs">
                                      {item.name}
                                    </span>
                                    {item.row_count != null && (
                                      <span className="ml-auto text-[10px] text-(--color-text-muted)">
                                        {item.row_count.toLocaleString()}
                                      </span>
                                    )}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
