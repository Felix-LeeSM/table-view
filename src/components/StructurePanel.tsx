import { useState, useEffect, useCallback } from "react";
import { Loader2, Key, Link2, Shield } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import type { ColumnInfo, IndexInfo, ConstraintInfo } from "../types/schema";

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
  const [hasFetched, setHasFetched] = useState(false);

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
    setHasFetched(true);
  }, [
    connectionId,
    table,
    schema,
    activeSubTab,
    getTableColumns,
    getTableIndexes,
    getTableConstraints,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setHasFetched(false);
  }, [activeSubTab]);

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
      </div>

      {/* Content */}
      {error && (
        <div
          role="alert"
          className="border-b border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-(--color-danger)"
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8">
          <Loader2
            className="animate-spin text-(--color-text-muted)"
            size={24}
          />
        </div>
      )}

      {!loading && activeSubTab === "columns" && columns.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Nullable
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Default
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Ref
                </th>
                <th className="border-b border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Comment
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((col) => (
                <tr
                  key={col.name}
                  className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  <td className="flex items-center gap-1.5 border-r border-(--color-border) px-3 py-1 text-xs">
                    {col.is_primary_key && (
                      <span title="Primary Key">
                        <Key
                          size={12}
                          className="shrink-0 text-amber-500"
                          aria-label="Primary Key"
                        />
                      </span>
                    )}
                    {col.is_foreign_key && (
                      <span title="Foreign Key">
                        <Link2
                          size={12}
                          className="shrink-0 text-(--color-accent)"
                        />
                      </span>
                    )}
                    <span className="text-(--color-text-primary)">
                      {col.name}
                    </span>
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {col.data_type}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs">
                    {col.nullable ? (
                      <span className="text-(--color-text-muted)">YES</span>
                    ) : (
                      <span className="font-medium text-(--color-text-primary)">
                        NO
                      </span>
                    )}
                  </td>
                  <td className="max-w-[200px] truncate border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                    {col.default_value ?? "\u2014"}
                  </td>
                  <td className="max-w-[200px] truncate border-r border-(--color-border) px-3 py-1 text-xs text-(--color-accent)">
                    {col.fk_reference ?? "\u2014"}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-1 text-xs text-(--color-text-muted)">
                    {col.comment ?? "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeSubTab === "indexes" && indexes.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Columns
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Properties
                </th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((idx) => (
                <tr
                  key={idx.name}
                  className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)">
                    {idx.name}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {idx.columns.join(", ")}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-muted)">
                    {idx.index_type}
                  </td>
                  <td className="flex items-center gap-2 px-3 py-1 text-xs">
                    {idx.is_primary && (
                      <span className="flex items-center gap-0.5 text-amber-500">
                        <Key size={10} aria-hidden="true" /> PK
                      </span>
                    )}
                    {idx.is_unique && !idx.is_primary && (
                      <span className="flex items-center gap-0.5 text-(--color-accent)">
                        <Shield size={10} /> UNIQUE
                      </span>
                    )}
                    {!idx.is_primary && !idx.is_unique && (
                      <span className="text-(--color-text-muted)">\u2014</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && activeSubTab === "constraints" && constraints.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Name
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Type
                </th>
                <th className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Columns
                </th>
                <th className="border-b border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)">
                  Reference
                </th>
              </tr>
            </thead>
            <tbody>
              {constraints.map((c) => (
                <tr
                  key={c.name}
                  className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)">
                    {c.name}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {c.constraint_type}
                  </td>
                  <td className="border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-secondary)">
                    {c.columns.join(", ")}
                  </td>
                  <td className="px-3 py-1 text-xs text-(--color-accent)">
                    {c.reference_table
                      ? `${c.reference_table}(${(c.reference_columns ?? []).join(", ")})`
                      : "\u2014"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading &&
        hasFetched &&
        error === null &&
        ((activeSubTab === "columns" && columns.length === 0) ||
          (activeSubTab === "indexes" && indexes.length === 0) ||
          (activeSubTab === "constraints" && constraints.length === 0)) && (
          <div className="px-3 py-4 text-center text-xs text-(--color-text-muted)">
            No {activeSubTab} found
          </div>
        )}
    </div>
  );
}
