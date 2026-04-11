import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Loader2, Filter, Key } from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import FilterBar from "./FilterBar";
import type {
  FilterCondition,
  FilterMode,
  SortInfo,
  TableData,
} from "../types/schema";

interface DataGridProps {
  connectionId: string;
  table: string;
  schema: string;
}

const PAGE_SIZE = 100;
const MIN_COL_WIDTH = 60;

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
  const [sorts, setSorts] = useState<SortInfo[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [appliedFilters, setAppliedFilters] = useState<FilterCondition[]>([]);
  const [showQuery, setShowQuery] = useState(true);
  const [filterMode, setFilterMode] = useState<FilterMode>("structured");
  const [rawSql, setRawSql] = useState("");
  const [appliedRawSql, setAppliedRawSql] = useState("");
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  // Reset column widths when table/schema changes
  useEffect(() => {
    setColumnWidths({});
  }, [connectionId, table, schema]);

  const getColumnWidth = useCallback(
    (colName: string) => columnWidths[colName] ?? 150,
    [columnWidths],
  );

  // Resize drag handler — writes directly to DOM during drag for perf,
  // commits final width to React state on mouseup only.
  const tableRef = useRef<HTMLTableElement>(null);
  const resizingRef = useRef<{
    colName: string;
    startX: number;
    startWidth: number;
    colIdx: number;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colName: string, colIdx: number) => {
      e.stopPropagation();
      e.preventDefault();
      const currentWidth = columnWidths[colName] ?? 150;
      resizingRef.current = {
        colName,
        startX: e.clientX,
        startWidth: currentWidth,
        colIdx,
      };

      const applyWidth = (width: number) => {
        if (!tableRef.current) return;
        const w = `${width}px`;
        // Update th + all td cells in this column directly via DOM
        const th = tableRef.current.querySelector(
          `th:nth-child(${colIdx + 1})`,
        ) as HTMLElement | null;
        if (th) th.style.width = w;
        const cells = tableRef.current.querySelectorAll(
          `td:nth-child(${colIdx + 1})`,
        );
        cells.forEach((td) => {
          (td as HTMLElement).style.width = w;
        });
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = moveEvent.clientX - resizingRef.current.startX;
        const newWidth = Math.max(
          MIN_COL_WIDTH,
          resizingRef.current.startWidth + delta,
        );
        applyWidth(newWidth);
      };

      const handleMouseUp = () => {
        if (resizingRef.current) {
          // Commit final width to React state
          const finalWidth = tableRef.current?.querySelector(
            `th:nth-child(${resizingRef.current.colIdx + 1})`,
          ) as HTMLElement | null;
          const w = finalWidth
            ? parseInt(finalWidth.style.width, 10)
            : resizingRef.current.startWidth;
          setColumnWidths((prev) => ({
            ...prev,
            [resizingRef.current!.colName]: w,
          }));
        }
        resizingRef.current = null;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [columnWidths],
  );

  // Cmd+F (Mac) / Ctrl+F (other) toggles the filter bar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "f" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowFilters((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const prevPropsRef = useRef({ connectionId, table, schema });
  useEffect(() => {
    const prev = prevPropsRef.current;
    if (
      prev.connectionId !== connectionId ||
      prev.table !== table ||
      prev.schema !== schema
    ) {
      setPage(1);
      prevPropsRef.current = { connectionId, table, schema };
    }
  }, [connectionId, table, schema]);

  const fetchIdRef = useRef(0);
  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const activeRaw =
        appliedRawSql.trim().length > 0 ? appliedRawSql.trim() : undefined;
      const activeFilters =
        appliedFilters.length > 0 ? appliedFilters : undefined;
      const orderBy =
        sorts.length > 0
          ? sorts.map((s) => `${s.column} ${s.direction}`).join(", ")
          : undefined;
      const result = await queryTableData(
        connectionId,
        table,
        schema,
        page,
        PAGE_SIZE,
        orderBy,
        activeRaw ? undefined : activeFilters, // raw_where takes precedence
        activeRaw,
      );
      if (fetchId === fetchIdRef.current) {
        setData(result);
      }
    } catch (e) {
      if (fetchId === fetchIdRef.current) {
        setError(String(e));
      }
    }
    if (fetchId === fetchIdRef.current) {
      setLoading(false);
    }
  }, [
    connectionId,
    table,
    schema,
    page,
    sorts,
    appliedFilters,
    appliedRawSql,
    queryTableData,
  ]);

  // Listen for context-aware refresh events (Cmd+R / F5)
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = data ? Math.ceil(data.total_count / PAGE_SIZE) : 0;

  const handleSort = (columnName: string, shiftKey: boolean = false) => {
    if (shiftKey) {
      // Shift+Click: add to sort list, toggle direction, or remove
      setSorts((prev) => {
        const existingIndex = prev.findIndex((s) => s.column === columnName);
        if (existingIndex !== -1) {
          // Column already in sort list - toggle direction or remove
          const existing = prev[existingIndex]!;
          if (existing.direction === "ASC") {
            // Toggle to DESC
            const newSorts = [...prev];
            newSorts[existingIndex] = { column: columnName, direction: "DESC" };
            return newSorts;
          } else {
            // Remove from sort list
            const newSorts = prev.filter((s) => s.column !== columnName);
            return newSorts;
          }
        } else {
          // Add new column to sort list
          return [...prev, { column: columnName, direction: "ASC" }];
        }
      });
    } else {
      // Click: replace all sorts with this column (cycle ASC → DESC → none)
      setSorts((prev) => {
        if (prev.length === 0 || prev[0]!.column !== columnName) {
          return [{ column: columnName, direction: "ASC" }];
        }
        if (prev[0]!.direction === "ASC") {
          return [{ column: columnName, direction: "DESC" }];
        }
        return [];
      });
    }
    setPage(1);
  };

  const handleApplyFilters = () => {
    if (filterMode === "raw") {
      setAppliedRawSql(rawSql);
      setAppliedFilters([]);
    } else {
      setAppliedFilters(filters);
      setAppliedRawSql("");
    }
    setPage(1);
  };

  const handleClearAllFilters = () => {
    setAppliedFilters([]);
    setAppliedRawSql("");
    setPage(1);
  };

  const activeFilterCount =
    appliedRawSql.trim().length > 0 ? 1 : appliedFilters.length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-(--color-border) px-3 py-1.5">
        <div className="flex items-center gap-2 text-xs text-(--color-text-secondary)">
          {data ? (
            <>
              {data.total_count.toLocaleString()} rows
              {sorts.length > 0 && (
                <span className="text-(--color-text-muted)">
                  Sorted by{" "}
                  {sorts.map((s) => `${s.column} ${s.direction}`).join(", ")}
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
          onClearAll={handleClearAllFilters}
          filterMode={filterMode}
          rawSql={rawSql}
          onFilterModeChange={setFilterMode}
          onRawSqlChange={setRawSql}
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

      {loading && !data && (
        <div className="flex items-center justify-center py-8">
          <Loader2
            className="animate-spin text-(--color-text-muted)"
            size={24}
          />
        </div>
      )}

      {data && (
        <div className="relative flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-(--color-bg-primary)/60">
              <Loader2
                className="animate-spin text-(--color-text-muted)"
                size={24}
              />
            </div>
          )}
          <table className="w-full border-collapse text-sm" ref={tableRef}>
            <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
              <tr>
                {data.columns.map((col, colIdx) => {
                  const sortInfo = sorts.find((s) => s.column === col.name);
                  const sortRank = sortInfo ? sorts.indexOf(sortInfo) + 1 : 0;
                  return (
                    <th
                      key={col.name}
                      className="relative cursor-pointer border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary) hover:bg-(--color-bg-tertiary)"
                      style={{
                        width: getColumnWidth(col.name),
                        minWidth: MIN_COL_WIDTH,
                      }}
                      onClick={(e) => handleSort(col.name, e.shiftKey)}
                      title={`Sort by ${col.name}`}
                    >
                      <div className="flex items-center gap-1">
                        {col.is_primary_key && (
                          <span title="Primary Key">
                            <Key
                              size={12}
                              className="shrink-0 text-amber-500"
                              aria-label="Primary Key"
                            />
                          </span>
                        )}
                        <span className="truncate">{col.name}</span>
                        {sortInfo && (
                          <span className="flex shrink-0 items-center gap-0.5 text-(--color-accent)">
                            <span className="text-[10px] font-bold">
                              {sortRank}
                            </span>
                            {sortInfo.direction === "ASC" ? "\u25B2" : "\u25BC"}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[10px] text-(--color-text-muted)">
                        {col.data_type}
                      </div>
                      {/* Resize handle */}
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-(--color-accent) active:bg-(--color-accent)"
                        onMouseDown={(e) =>
                          handleResizeStart(e, col.name, colIdx)
                        }
                        onClick={(e) => e.stopPropagation()}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIdx) => (
                <tr
                  key={`row-${page}-${rowIdx}`}
                  className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
                >
                  {(row as unknown[]).map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="whitespace-normal break-words border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)"
                      style={{
                        width: getColumnWidth(
                          data.columns[cellIdx]?.name ?? "",
                        ),
                        minWidth: MIN_COL_WIDTH,
                      }}
                      title={
                        cell == null
                          ? "NULL"
                          : typeof cell === "object" && cell !== null
                            ? JSON.stringify(cell, null, 2)
                            : String(cell)
                      }
                    >
                      {cell == null ? (
                        <span className="italic text-(--color-text-muted)">
                          NULL
                        </span>
                      ) : typeof cell === "object" && cell !== null ? (
                        JSON.stringify(cell, null, 2)
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

      {/* Executed query bar */}
      {data && (
        <div className="border-t border-(--color-border)">
          <button
            className="flex w-full items-center gap-1 px-3 py-1 text-xs text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
            onClick={() => setShowQuery(!showQuery)}
            aria-expanded={showQuery}
            aria-label={showQuery ? "Hide query" : "Show query"}
          >
            <ChevronRight
              size={10}
              className={`transition-transform ${showQuery ? "rotate-90" : ""}`}
            />
            <span>Query</span>
          </button>
          {showQuery && (
            <div
              className="max-h-32 overflow-auto bg-(--color-bg-secondary) px-3 py-1.5"
              role="region"
              aria-label="Executed SQL query"
            >
              <code className="whitespace-pre-wrap break-all text-xs text-(--color-text-secondary)">
                {data.executed_query}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
