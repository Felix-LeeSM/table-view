import { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Loader2,
  Filter,
  Key,
  Check,
  X,
  Plus,
  Trash2,
} from "lucide-react";
import { useSchemaStore } from "../stores/schemaStore";
import { useTabStore } from "../stores/tabStore";
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

const DEFAULT_PAGE_SIZE = 100;
const PAGE_SIZE_OPTIONS = [100, 300, 500, 1000];
const MIN_COL_WIDTH = 60;
const MAX_COL_WIDTH = 400;
const CELL_DISPLAY_LIMIT = 200;

function truncateCell(value: string): string {
  if (value.length <= CELL_DISPLAY_LIMIT) return value;
  return value.slice(0, CELL_DISPLAY_LIMIT) + "...";
}

function calcDefaultColWidth(name: string, dataType: string): number {
  const nameWidth = name.length * 8 + 40;
  const typeWidth = dataType.length * 6 + 20;
  return Math.max(
    MIN_COL_WIDTH,
    Math.min(MAX_COL_WIDTH, Math.max(nameWidth, typeWidth)),
  );
}

function getInputTypeForColumn(dataType: string): string {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp")) return "datetime-local";
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  return "text";
}

export default function DataGrid({
  connectionId,
  table,
  schema,
}: DataGridProps) {
  const queryTableData = useSchemaStore((s) => s.queryTableData);
  const executeQuery = useSchemaStore((s) => s.executeQuery);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const promoteTab = useTabStore((s) => s.promoteTab);
  const [data, setData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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

  // Inline cell editing state
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingEdits, setPendingEdits] = useState<Map<string, string>>(
    new Map(),
  );

  // SQL preview modal state
  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);

  // Row operations state
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const [pendingNewRows, setPendingNewRows] = useState<unknown[][]>([]);
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<
    Set<string>
  >(new Set());

  // Reset column widths when table/schema changes
  useEffect(() => {
    setColumnWidths({});
  }, [connectionId, table, schema]);

  // Promote preview tab to permanent when user interacts (page change, filter, sort)
  useEffect(() => {
    if (activeTabId) {
      promoteTab(activeTabId);
    }
  }, [page, appliedFilters, appliedRawSql, sorts, activeTabId, promoteTab]);

  const getColumnWidth = useCallback(
    (colName: string, dataType: string = "") => {
      if (columnWidths[colName]) return columnWidths[colName];
      return calcDefaultColWidth(colName, dataType);
    },
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
        pageSize,
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
    pageSize,
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

  const totalPages = data ? Math.ceil(data.total_count / pageSize) : 0;

  // -- Inline editing helpers --------------------------------------------------

  const editKey = (row: number, col: number) => `${row}-${col}`;

  const saveCurrentEdit = useCallback(() => {
    if (!editingCell) return;
    const key = editKey(editingCell.row, editingCell.col);
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(key, editValue);
      return next;
    });
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const handleStartEdit = useCallback(
    (rowIdx: number, colIdx: number, currentValue: string) => {
      // Save any existing edit first
      if (editingCell) {
        const key = editKey(editingCell.row, editingCell.col);
        setPendingEdits((prev) => {
          const next = new Map(prev);
          next.set(key, editValue);
          return next;
        });
      }
      setEditingCell({ row: rowIdx, col: colIdx });
      setEditValue(currentValue);
      // Promote preview tab on inline edit start
      if (activeTabId) promoteTab(activeTabId);
    },
    [editingCell, editValue, activeTabId, promoteTab],
  );

  // -- SQL generation for pending edits ----------------------------------------

  const generateSql = useCallback((): string[] => {
    if (!data) return [];
    const pkCols = data.columns.filter((c) => c.is_primary_key);
    const statements: string[] = [];

    // UPDATE statements for cell edits
    pendingEdits.forEach((newValue, key) => {
      const [rowStr, colStr] = key.split("-");
      const rowIdx = parseInt(rowStr!, 10);
      const colIdx = parseInt(colStr!, 10);
      const col = data.columns[colIdx];
      if (!col) return;

      const row = data.rows[rowIdx] as unknown[];
      if (!row) return;

      const qualifiedTable = schema ? `${schema}.${table}` : table;

      let whereClause: string;
      if (pkCols.length > 0) {
        whereClause = pkCols
          .map((pk) => {
            const pkIdx = data.columns.indexOf(pk);
            const pkVal = row[pkIdx];
            return `${pk.name} = ${pkVal == null ? "NULL" : typeof pkVal === "string" ? `'${pkVal}'` : String(pkVal)}`;
          })
          .join(" AND ");
      } else {
        // Fallback: use all columns for WHERE
        whereClause = data.columns
          .map((c, i) => {
            const val = row[i];
            return `${c.name} = ${val == null ? "NULL" : typeof val === "string" ? `'${val}'` : String(val)}`;
          })
          .join(" AND ");
      }

      const escapedValue =
        newValue === "" ? "NULL" : `'${newValue.replace(/'/g, "''")}'`;
      statements.push(
        `UPDATE ${qualifiedTable} SET ${col.name} = ${escapedValue} WHERE ${whereClause};`,
      );
    });

    // DELETE statements for deleted rows
    const qualifiedTable = schema ? `${schema}.${table}` : table;
    pendingDeletedRowKeys.forEach((delKey) => {
      // delKey format: "row-{page}-{rowIdx}"
      const parts = delKey.split("-");
      const rowIdx = parseInt(parts[2]!, 10);
      const row = data.rows[rowIdx] as unknown[];
      if (!row) return;

      let whereClause: string;
      if (pkCols.length > 0) {
        whereClause = pkCols
          .map((pk) => {
            const pkIdx = data.columns.indexOf(pk);
            const pkVal = row[pkIdx];
            return `${pk.name} = ${pkVal == null ? "NULL" : typeof pkVal === "string" ? `'${pkVal}'` : String(pkVal)}`;
          })
          .join(" AND ");
      } else {
        whereClause = data.columns
          .map((c, i) => {
            const val = row[i];
            return `${c.name} = ${val == null ? "NULL" : typeof val === "string" ? `'${val}'` : String(val)}`;
          })
          .join(" AND ");
      }
      statements.push(`DELETE FROM ${qualifiedTable} WHERE ${whereClause};`);
    });

    // INSERT statements for new rows
    for (const newRow of pendingNewRows) {
      const colList = data.columns.map((c) => c.name).join(", ");
      const valList = (newRow as unknown[])
        .map((v) =>
          v == null ? "NULL" : typeof v === "string" ? `'${v}'` : String(v),
        )
        .join(", ");
      statements.push(
        `INSERT INTO ${qualifiedTable} (${colList}) VALUES (${valList});`,
      );
    }

    return statements;
  }, [
    data,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
    schema,
    table,
  ]);

  const handleCommit = useCallback(() => {
    const sqlStatements = generateSql();
    if (sqlStatements.length === 0) return;
    setSqlPreview(sqlStatements);
  }, [generateSql]);

  const handleExecuteCommit = useCallback(async () => {
    if (!sqlPreview) return;
    try {
      for (const sql of sqlPreview) {
        await executeQuery(connectionId, sql, `edit-${Date.now()}`);
      }
      setSqlPreview(null);
      setPendingEdits(new Map());
      setPendingNewRows([]);
      setPendingDeletedRowKeys(new Set());
      setSelectedRowIdx(null);
      // Refresh data
      fetchData();
    } catch {
      // Error handling is done via the fetchData flow
    }
  }, [sqlPreview, executeQuery, connectionId, fetchData]);

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map());
    setEditingCell(null);
    setEditValue("");
    setPendingNewRows([]);
    setPendingDeletedRowKeys(new Set());
    setSelectedRowIdx(null);
  }, []);

  // Row operation helpers
  const rowKeyFn = useCallback(
    (rowIdx: number) => `row-${page}-${rowIdx}`,
    [page],
  );

  const handleAddRow = useCallback(() => {
    if (!data) return;
    const emptyRow = data.columns.map(() => null);
    setPendingNewRows((prev) => [...prev, emptyRow]);
    // Promote preview tab on row add
    if (activeTabId) promoteTab(activeTabId);
  }, [data, activeTabId, promoteTab]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRowIdx === null) return;
    setPendingDeletedRowKeys((prev) => {
      const next = new Set(prev);
      next.add(rowKeyFn(selectedRowIdx));
      return next;
    });
    setSelectedRowIdx(null);
    // Promote preview tab on row delete
    if (activeTabId) promoteTab(activeTabId);
  }, [selectedRowIdx, rowKeyFn, activeTabId, promoteTab]);

  const hasPendingChanges =
    pendingEdits.size > 0 ||
    pendingNewRows.length > 0 ||
    pendingDeletedRowKeys.size > 0;

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
              {pendingEdits.size > 0 && (
                <span className="text-yellow-500">
                  {pendingEdits.size} edit{pendingEdits.size !== 1 ? "s" : ""}
                </span>
              )}
              {(pendingNewRows.length > 0 ||
                pendingDeletedRowKeys.size > 0) && (
                <span className="text-yellow-500">
                  {pendingNewRows.length > 0 && `${pendingNewRows.length} new`}
                  {pendingNewRows.length > 0 &&
                    pendingDeletedRowKeys.size > 0 &&
                    ", "}
                  {pendingDeletedRowKeys.size > 0 &&
                    `${pendingDeletedRowKeys.size} del`}
                </span>
              )}
              {hasPendingChanges && (
                <>
                  <button
                    className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-0.5 text-xs text-green-400 hover:bg-green-600/30"
                    onClick={handleCommit}
                    aria-label="Commit changes"
                    title="Commit changes"
                  >
                    <Check size={12} />
                    Commit
                  </button>
                  <button
                    className="flex items-center gap-1 rounded bg-red-600/20 px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/30"
                    onClick={handleDiscard}
                    aria-label="Discard changes"
                    title="Discard changes"
                  >
                    <X size={12} />
                    Discard
                  </button>
                </>
              )}
            </>
          ) : (
            `${schema}.${table}`
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <>
              <button
                className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary)"
                onClick={handleAddRow}
                aria-label="Add row"
                title="Add row"
              >
                <Plus size={14} />
              </button>
              <button
                className="rounded p-1 text-(--color-text-muted) hover:bg-(--color-bg-tertiary) disabled:opacity-30"
                onClick={handleDeleteRow}
                disabled={selectedRowIdx === null}
                aria-label="Delete row"
                title="Delete row"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
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
                onClick={() => setPage(1)}
                aria-label="First page"
              >
                <ChevronsLeft size={14} />
              </button>
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
              <input
                type="number"
                min={1}
                max={totalPages}
                className="w-10 rounded border border-(--color-border) bg-(--color-bg-primary) px-1 py-0.5 text-xs text-(--color-text-primary) text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                aria-label="Jump to page"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = parseInt(
                      (e.target as HTMLInputElement).value,
                      10,
                    );
                    if (val >= 1 && val <= totalPages) {
                      setPage(val);
                    }
                  }
                }}
              />
              <button
                className="rounded p-0.5 hover:bg-(--color-bg-tertiary) disabled:opacity-30"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
              <button
                className="rounded p-0.5 hover:bg-(--color-bg-tertiary) disabled:opacity-30"
                disabled={page >= totalPages}
                onClick={() => setPage(totalPages)}
                aria-label="Last page"
              >
                <ChevronsRight size={14} />
              </button>
            </div>
          )}
          {data && (
            <select
              className="rounded border border-(--color-border) bg-(--color-bg-primary) px-1 py-0.5 text-xs text-(--color-text-primary)"
              value={pageSize}
              aria-label="Page size"
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
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
                        width: getColumnWidth(col.name, col.data_type),
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
                      <div
                        className="mt-0.5 truncate text-[10px] text-(--color-text-muted)"
                        title={col.data_type}
                      >
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
              {data.rows.map((row, rowIdx) => {
                const rk = rowKeyFn(rowIdx);
                const isDeleted = pendingDeletedRowKeys.has(rk);
                const isSelected = selectedRowIdx === rowIdx;
                return (
                  <tr
                    key={rk}
                    className={`border-b border-(--color-border) hover:bg-(--color-bg-tertiary)${isSelected ? " bg-accent/20" : ""}${isDeleted ? " line-through opacity-50" : ""}`}
                    onClick={() => setSelectedRowIdx(rowIdx)}
                  >
                    {(row as unknown[]).map((cell, cellIdx) => {
                      const key = editKey(rowIdx, cellIdx);
                      const isEditing =
                        editingCell?.row === rowIdx &&
                        editingCell?.col === cellIdx;
                      const hasPendingEdit = pendingEdits.has(key);
                      const cellStr =
                        cell == null
                          ? ""
                          : typeof cell === "object" && cell !== null
                            ? JSON.stringify(cell, null, 2)
                            : String(cell);
                      const displayValue = hasPendingEdit
                        ? pendingEdits.get(key)!
                        : cellStr;

                      return (
                        <td
                          key={cellIdx}
                          className={`overflow-hidden border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)${hasPendingEdit ? " bg-yellow-500/20" : ""}`}
                          style={{
                            width: getColumnWidth(
                              data.columns[cellIdx]?.name ?? "",
                              data.columns[cellIdx]?.data_type ?? "",
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
                          onDoubleClick={() =>
                            handleStartEdit(rowIdx, cellIdx, cellStr)
                          }
                          onClick={() => {
                            if (editingCell) {
                              saveCurrentEdit();
                            }
                          }}
                        >
                          {isEditing ? (
                            <input
                              type={getInputTypeForColumn(
                                data.columns[cellIdx]?.data_type ?? "",
                              )}
                              className="w-full border-none bg-transparent p-0 text-xs text-(--color-text-primary) outline-none"
                              value={editValue}
                              autoFocus
                              onChange={(e) => setEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  saveCurrentEdit();
                                } else if (e.key === "Escape") {
                                  e.stopPropagation();
                                  cancelEdit();
                                }
                              }}
                            />
                          ) : hasPendingEdit ? (
                            <span className="line-clamp-3">{displayValue}</span>
                          ) : cell == null ? (
                            <span className="italic text-(--color-text-muted)">
                              NULL
                            </span>
                          ) : (
                            <span className="line-clamp-3">
                              {truncateCell(
                                typeof cell === "object" && cell !== null
                                  ? JSON.stringify(cell, null, 2)
                                  : String(cell),
                              )}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {data.rows.length === 0 && pendingNewRows.length === 0 && (
                <tr>
                  <td
                    colSpan={data.columns.length}
                    className="px-3 py-4 text-center text-xs text-(--color-text-muted)"
                  >
                    No data
                  </td>
                </tr>
              )}
              {pendingNewRows.map((newRow, newIdx) => (
                <tr
                  key={`new-row-${newIdx}`}
                  className="border-b border-(--color-border) bg-yellow-500/5 hover:bg-(--color-bg-tertiary)"
                >
                  {(newRow as unknown[]).map((cell, cellIdx) => (
                    <td
                      key={cellIdx}
                      className="overflow-hidden border-r border-(--color-border) px-3 py-1 text-xs italic text-(--color-text-muted)"
                      style={{
                        width: getColumnWidth(
                          data.columns[cellIdx]?.name ?? "",
                          data.columns[cellIdx]?.data_type ?? "",
                        ),
                        minWidth: MIN_COL_WIDTH,
                      }}
                    >
                      {cell == null ? "NULL" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
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

      {/* SQL Preview Modal */}
      {sqlPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-label="SQL Preview"
        >
          <div className="w-[600px] max-h-[80vh] flex flex-col rounded-lg border border-(--color-border) bg-(--color-bg-primary) shadow-xl">
            <div className="flex items-center justify-between border-b border-(--color-border) px-4 py-3">
              <h3 className="text-sm font-semibold text-(--color-text-primary)">
                SQL Preview
              </h3>
              <button
                className="rounded p-1 hover:bg-(--color-bg-tertiary)"
                onClick={() => setSqlPreview(null)}
                aria-label="Close SQL preview"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {sqlPreview.map((sql, i) => (
                <pre
                  key={i}
                  className="mb-2 whitespace-pre-wrap break-all rounded bg-(--color-bg-secondary) p-2 text-xs text-(--color-text-secondary)"
                >
                  {sql}
                </pre>
              ))}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-(--color-border) px-4 py-3">
              <button
                className="rounded bg-(--color-bg-tertiary) px-3 py-1.5 text-xs text-(--color-text-secondary) hover:bg-(--color-bg-secondary)"
                onClick={() => setSqlPreview(null)}
              >
                Cancel
              </button>
              <button
                className="rounded bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700"
                onClick={handleExecuteCommit}
                aria-label="Execute SQL"
              >
                Execute
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
