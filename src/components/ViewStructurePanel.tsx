import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import type { ColumnInfo } from "../types/schema";

interface ViewStructurePanelProps {
  connectionId: string;
  view: string;
  schema: string;
}

type ViewSubTab = "columns" | "definition";

const SUB_TABS: { key: ViewSubTab; label: string }[] = [
  { key: "columns", label: "Columns" },
  { key: "definition", label: "Definition" },
];

export default function ViewStructurePanel({
  connectionId,
  view,
  schema,
}: ViewStructurePanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<ViewSubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [definition, setDefinition] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getViewColumns = useSchemaStore((s) => s.getViewColumns);
  const getViewDefinition = useSchemaStore((s) => s.getViewDefinition);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getViewColumns(connectionId, schema, view);
        setColumns(cols);
      } else {
        const def = await getViewDefinition(connectionId, schema, view);
        setDefinition(def);
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [
    connectionId,
    view,
    schema,
    activeSubTab,
    getViewColumns,
    getViewDefinition,
  ]);

  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-border bg-secondary">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeSubTab === tab.key}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              activeSubTab === tab.key
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-secondary-foreground"
            }`}
            onClick={() => setActiveSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
        <span className="ml-auto pr-3 text-[10px] uppercase tracking-wider text-muted-foreground">
          Read-only
        </span>
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}

      {/* Content */}
      {!loading && !error && activeSubTab === "columns" && (
        <ViewColumnsTable columns={columns} />
      )}
      {!loading && !error && activeSubTab === "definition" && (
        <ViewDefinition sql={definition} />
      )}
    </div>
  );
}

function ViewColumnsTable({ columns }: { columns: ColumnInfo[] }) {
  if (columns.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8 text-sm text-muted-foreground">
        No columns
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 bg-secondary">
          <tr className="border-b border-border">
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              Name
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              Type
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              Nullable
            </th>
            <th className="border-r border-border px-3 py-1.5 text-left font-medium text-secondary-foreground">
              Default
            </th>
            <th className="px-3 py-1.5 text-left font-medium text-secondary-foreground">
              Comment
            </th>
          </tr>
        </thead>
        <tbody>
          {columns.map((col) => (
            <tr
              key={col.name}
              className="border-b border-border hover:bg-muted"
            >
              <td className="border-r border-border px-3 py-1 text-foreground">
                {col.name}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.data_type}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.nullable ? "YES" : "NO"}
              </td>
              <td className="border-r border-border px-3 py-1 text-secondary-foreground">
                {col.default_value ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-1 text-secondary-foreground">
                {col.comment ?? (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ViewDefinition({ sql }: { sql: string }) {
  if (!sql.trim()) {
    return (
      <div className="flex flex-1 items-center justify-center px-3 py-8 text-sm text-muted-foreground">
        Definition not available
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-3">
      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-secondary p-3 font-mono text-xs text-foreground">
        {sql}
      </pre>
    </div>
  );
}
