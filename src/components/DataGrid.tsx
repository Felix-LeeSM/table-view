import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Loader2, Filter } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import FilterBar from "./FilterBar";
import type { FilterCondition, TableData } from "../types/schema";

interface DataGridProps {
  connectionId: string;
  table: string;
  schema: string;
}

const PAGE_SIZE = 100;

export default function DataGrid({
  connectionId,
  table,
  schema,
}: DataGridProps) {
  const queryTableData = useSchemaStore((s) => s.queryTableData);
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const activeFilters =
        appliedFilters.length > 0 ? appliedFilters : undefined;
      const result = await queryTableData(
        connectionId,
        table,
        schema,
        page,
        PAGE_SIZE,
        sortColumn ?? undefined,
        activeFilters,
      );
      setData(result);
    } catch (e) {
      setError(String(e));
    }
    setLoading(false);
  }, [
    connectionId,
    table,
    schema,
    page,
    sortColumn,
    appliedFilters,
    queryTableData,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total_count / PAGE_SIZE) : 0;

  const handleSort = (columnName: string) => {
    setSortColumn((prev) => (prev === columnName ? null : columnName));
    setPage(1);
  };

  const handleApplyFilters = () => {
    setAppliedFilters(filters);
    setPage(1);
  };

  const activeFilterCount = appliedFilters.length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-(--color-border) px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-(--color-text-secondary)">
          {data ? (
            <>
              {data.total_count.toLocaleString()} rows
              {sortColumn && (
                <span className="text-(--color-text-muted)">
                  Sorted by {sortColumn}
                </span>
              )}
            </>
          ) : (
            `${schema}.${table}`
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={`relative rounded p-1 hover:bg-(--color-bg-tertiary) ${
              showFilters
                ? "text-(--color-accent)"
                : "text-(--color-text-muted)"
            }`}
            onClick={() => setShowFilters((prev) => !prev)}
            aria-label="Toggle filters"
            title="Toggle filters"
          >
            <Filter size={14} />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-(--color-accent) text-[8px] font-bold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>
          {data && totalPages > 1 && (
            <div className="flex items-center gap-2">
              <button
                className="rounded p-0.5 hover:bg-(--color-bg-tertiary) disabled:opacity-30"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs text-(--color-text-muted)">
                {page} / {totalPages}
              </span>
              <button
                className="rounded p-0.5 hover:bg-(--color-bg-tertiary) disabled:opacity-30"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Filter bar */}
      {showFilters && (
        <FilterBar
          columns={data?.columns ?? []}
          filters={filters}
          onFiltersChange={setFilters}
          onApply={handleApplyFilters}
          onClose={() => setShowFilters(false)}
        />
      )}

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

      {data && !loading && (
        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                {data.columns.map((col) => (
                  <th
                    key={col.name}
                    className="cursor-pointer border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
                    onClick={() => handleSort(col.name)}
                    title={`Sort by ${col.name}`}
                  >
                    <div className="flex items-center gap-1">
                      {col.is_primary_key && (
                        <span className="text-amber-500" title="Primary Key">
                          &#128273;
                        </span>
                      )}
                      <span>{col.name}</span>
                      <span className="text-[10px] text-(--color-text-muted)">
                        {col.data_type}
                      </span>
                      {sortColumn === col.name && (
                        <span className="text-(--color-accent)">&#9650;</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIdx) => (
                <tr
                  key={rowIdx}
                  className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  {(row as unknown[]).map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="max-w-[300px] truncate border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)"
                      title={cell == null ? "NULL" : String(cell)}
                    >
                      {cell == null ? (
                        <span className="italic text-(--color-text-muted)">
                          NULL
                        </span>
                      ) : (
                        String(cell)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={data.columns.length}
                    className="px-3 py-4 text-center text-xs text-(--color-text-muted)"
                  >
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
