import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "../types/schema";
import ColumnsEditor from "./structure/ColumnsEditor";
import IndexesEditor from "./structure/IndexesEditor";
import ConstraintsEditor from "./structure/ConstraintsEditor";

interface StructurePanelProps {
  connectionId: string;
  table: string;
  schema: string;
}

type SubTab = "columns" | "indexes" | "constraints";

export default function StructurePanel({
  connectionId,
  table,
  schema,
}: StructurePanelProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("columns");
  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [indexes, setIndexes] = useState<IndexInfo[]>([]);
  const [constraints, setConstraints] = useState<ConstraintInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const getTableIndexes = useSchemaStore((s) => s.getTableIndexes);
  const getTableConstraints = useSchemaStore((s) => s.getTableConstraints);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (activeSubTab === "columns") {
        const cols = await getTableColumns(connectionId, table, schema);
        setColumns(cols);
      } else if (activeSubTab === "indexes") {
        const idx = await getTableIndexes(connectionId, table, schema);
        setIndexes(idx);
      } else {
        const cons = await getTableConstraints(connectionId, table, schema);
        setConstraints(cons);
      }
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [
    connectionId,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
  ]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-structure", handler);
    return () => window.removeEventListener("refresh-structure", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const subTabs: { key: SubTab; label: string }[] = [
    { key: "columns", label: "Columns" },
    { key: "indexes", label: "Indexes" },
    { key: "constraints", label: "Constraints" },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-0 border-b border-(--color-border) bg-(--color-bg-secondary)">
        {subTabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeSubTab === tab.key}
            className={`px-4 py-1.5 text-xs font-medium transition-colors ${
              activeSubTab === tab.key
                ? "border-b-2 border-(--color-accent) text-(--color-text-primary)"
                : "text-(--color-text-muted) hover:text-(--color-text-secondary)"
            }`}
            onClick={() => setActiveSubTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}

        {/* Column editing actions */}
        {activeSubTab === "columns" && (
          <ColumnsEditor
            key={`${connectionId}-${table}-${schema}`}
            connectionId={connectionId}
            table={table}
            schema={schema}
            columns={columns}
            onRefresh={fetchData}
          />
        )}

        {/* Index actions */}
        {activeSubTab === "indexes" && (
          <IndexesEditor
            connectionId={connectionId}
            table={table}
            schema={schema}
            indexes={indexes}
            columns={columns}
            onColumnsChange={setColumns}
            onRefresh={fetchData}
          />
        )}

        {/* Constraint actions */}
        {activeSubTab === "constraints" && (
          <ConstraintsEditor
            connectionId={connectionId}
            table={table}
            schema={schema}
            constraints={constraints}
            columns={columns}
            onColumnsChange={setColumns}
            onRefresh={fetchData}
          />
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)"
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2
            className="animate-spin text-(--color-text-muted)"
            size={24}
          />
        </div>
      )}
    </div>
  );
}
