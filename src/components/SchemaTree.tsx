import { useState, useEffect, useRef } from "react";
import {
  ChevronRight,
  ChevronDown,
  Table2,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import { useTabStore } from "../stores/tabStore";

const EMPTY_SCHEMAS: never[] = [];

interface SchemaTreeProps {
  connectionId: string;
}

export default function SchemaTree({ connectionId }: SchemaTreeProps) {
  const schemas =
    useSchemaStore((s) => s.schemas[connectionId]) ?? EMPTY_SCHEMAS;
  const loadSchemas = useSchemaStore((s) => s.loadSchemas);
  const loadTables = useSchemaStore((s) => s.loadTables);
  const addTab = useTabStore((s) => s.addTab);
  const tables = useSchemaStore((s) => s.tables);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(
    new Set(),
  );
  const [loadingSchemas, setLoadingSchemas] = useState(false);
  const [loadingTables, setLoadingTables] = useState<Set<string>>(new Set());
  const autoLoadedRef = useRef<string | null>(null);

  // Auto-load schemas on mount or when connectionId changes
  useEffect(() => {
    if (autoLoadedRef.current === connectionId) return;
    autoLoadedRef.current = connectionId;
    setLoadingSchemas(true);
    loadSchemas(connectionId).finally(() => setLoadingSchemas(false));
  }, [connectionId, loadSchemas]);

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
      await loadTables(connectionId, schemaName);
      setLoadingTables((prev) => {
        const next = new Set(prev);
        next.delete(schemaName);
        return next;
      });
    }
  };

  const handleRefresh = async () => {
    setLoadingSchemas(true);
    await loadSchemas(connectionId);
    setLoadingSchemas(false);
  };

  const handleTableClick = (tableName: string, schemaName: string) => {
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

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-3 py-1">
        <span className="text-xs font-medium uppercase tracking-wider text-(--color-text-muted)">
          Schemas
        </span>
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

      {schemas.map((schema) => {
        const isExpanded = expandedSchemas.has(schema.name);
        const tableKey = `${connectionId}:${schema.name}`;
        const schemaTables = tables[tableKey] ?? [];
        const isLoadingTables = loadingTables.has(schema.name);

        return (
          <div key={schema.name}>
            <div
              className="flex cursor-pointer items-center gap-1 px-3 py-1 text-xs font-medium text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${schema.name} schema`}
              onClick={() => handleExpandSchema(schema.name)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleExpandSchema(schema.name);
                }
              }}
            >
              {isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <span className="truncate">{schema.name}</span>
              {isLoadingTables && (
                <Loader2 size={10} className="ml-auto animate-spin" />
              )}
            </div>

            {isExpanded && (
              <div>
                {schemaTables.length === 0 && !isLoadingTables && (
                  <div className="px-6 py-1 text-xs text-(--color-text-muted)">
                    No tables
                  </div>
                )}
                {schemaTables.map((table) => (
                  <div
                    key={table.name}
                    className="flex cursor-pointer items-center gap-1.5 px-6 py-1 hover:bg-(--color-bg-tertiary)"
                    role="button"
                    tabIndex={0}
                    aria-label={`${table.name} table`}
                    onClick={() => handleTableClick(table.name, schema.name)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        handleTableClick(table.name, schema.name);
                      }
                    }}
                  >
                    <Table2
                      size={12}
                      className="shrink-0 text-(--color-text-muted)"
                    />
                    <span className="truncate text-xs text-(--color-text-primary)">
                      {table.name}
                    </span>
                    {table.row_count != null && (
                      <span className="ml-auto text-[10px] text-(--color-text-muted)">
                        {table.row_count.toLocaleString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
