import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useDocumentStore } from "@stores/documentStore";
import type { ColumnInfo, TableData } from "@/types/schema";
import { isDocumentSentinel } from "@/types/document";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import { cn } from "@lib/utils";

interface DocumentDataGridProps {
  connectionId: string;
  database: string;
  collection: string;
}

const DEFAULT_PAGE_SIZE = 300;

/**
 * Sprint 66/71 — read-only grid for document-paradigm tabs.
 *
 * Sprint 66 shipped the fetch + render skeleton; Sprint 71 layers single-row
 * selection, Cmd+L Quick Look toggling, and BSON tree preview on top of it.
 * Composite cells (`"{...}"` / `"[N items]"`) render as muted sentinels via
 * `isDocumentSentinel()`. Editing, MQL preview, and filtering remain
 * deferred to Sprint 73.
 */
export default function DocumentDataGrid({
  connectionId,
  database,
  collection,
}: DocumentDataGridProps) {
  const runFind = useDocumentStore((s) => s.runFind);
  const queryResult = useDocumentStore(
    (s) => s.queryResults[`${connectionId}:${database}:${collection}`],
  );

  const [page, setPage] = useState(1);
  const [pageSize] = useState(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(
    () => new Set(),
  );
  const [showQuickLook, setShowQuickLook] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await runFind(connectionId, database, collection, {
        skip: (page - 1) * pageSize,
        limit: pageSize,
      });
    } catch (e) {
      if (fetchIdRef.current === fetchId) setError(String(e));
    } finally {
      if (fetchIdRef.current === fetchId) setLoading(false);
    }
  }, [runFind, connectionId, database, collection, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Cmd+L (Mac) / Ctrl+L (other) toggles the Quick Look panel. Same shape
  // as `DataGrid.tsx:100-110` so keyboard behaviour stays consistent across
  // paradigms.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "l" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowQuickLook((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Page-local row indices become meaningless once the page changes, so we
  // reset the selection whenever `page` flips. This also catches the
  // back-button case where the user pages backwards.
  useEffect(() => {
    setSelectedRowIds(new Set());
  }, [page]);

  const handleRowClick = useCallback((rowIdx: number) => {
    setSelectedRowIds((prev) => {
      const next = new Set<number>();
      // Single-select: re-clicking the active row clears selection; clicking
      // any other row replaces the selection with that row's index.
      if (!prev.has(rowIdx)) next.add(rowIdx);
      return next;
    });
  }, []);

  // Convert DocumentQueryResult → a minimal TableData-compatible shape so
  // the rest of the grid code path can reuse existing formatting helpers
  // later. For now we render directly since editing is disabled.
  const data: TableData | null = useMemo(() => {
    if (!queryResult) return null;
    const columns: ColumnInfo[] = queryResult.columns.map((c) => ({
      name: c.name,
      data_type: c.data_type,
      nullable: true,
      default_value: null,
      is_primary_key: c.name === "_id",
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    }));
    return {
      columns,
      rows: queryResult.rows,
      total_count: queryResult.total_count,
      page,
      page_size: pageSize,
      executed_query: `db.${database}.${collection}.find({}).skip(${
        (page - 1) * pageSize
      }).limit(${pageSize})`,
    };
  }, [queryResult, page, pageSize, database, collection]);

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total_count / pageSize))
    : 1;

  const showQuickLookMounted =
    showQuickLook && selectedRowIds.size > 0 && !!queryResult;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-border bg-secondary px-3 py-1 text-xs">
        <span className="text-secondary-foreground">
          {database}.{collection}
        </span>
        {data && (
          <span className="text-muted-foreground">
            {data.total_count.toLocaleString()} docs
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-2xs disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="text-2xs text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-2xs disabled:opacity-50"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= totalPages || loading}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}

      {data && (
        <div className="relative flex-1 overflow-auto">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/60">
              <Loader2
                className="animate-spin text-muted-foreground"
                size={24}
              />
            </div>
          )}
          <table className="min-w-full table-fixed border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-secondary">
              <tr>
                {data.columns.map((col) => (
                  <th
                    key={col.name}
                    className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
                  >
                    <div className="flex items-center gap-1">
                      <span className="truncate">{col.name}</span>
                    </div>
                    <div className="mt-0.5 truncate text-3xs text-muted-foreground">
                      {col.data_type}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIdx) => {
                const selected = selectedRowIds.has(rowIdx);
                return (
                  <tr
                    key={`row-${page}-${rowIdx}`}
                    aria-selected={selected}
                    onClick={() => handleRowClick(rowIdx)}
                    className={cn(
                      "cursor-pointer border-b border-border hover:bg-muted",
                      selected && "bg-accent dark:bg-accent/60",
                    )}
                  >
                    {data.columns.map((col, colIdx) => {
                      const cell = (row as unknown[])[colIdx];
                      const isSentinel = isDocumentSentinel(cell);
                      const isNull = cell == null;
                      return (
                        <td
                          key={col.name}
                          className="overflow-hidden border-r border-border px-3 py-1 text-xs"
                          title={
                            isNull
                              ? "null"
                              : typeof cell === "object"
                                ? JSON.stringify(cell)
                                : String(cell)
                          }
                        >
                          {isNull ? (
                            <span className="italic text-muted-foreground">
                              null
                            </span>
                          ) : isSentinel ? (
                            <span className="italic text-muted-foreground">
                              {String(cell)}
                            </span>
                          ) : (
                            <span className="line-clamp-3 text-foreground">
                              {typeof cell === "object"
                                ? JSON.stringify(cell)
                                : String(cell)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {data.rows.length === 0 && (
                <tr>
                  <td
                    colSpan={data.columns.length || 1}
                    className="px-3 py-4 text-center text-xs text-muted-foreground"
                  >
                    No documents
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {showQuickLookMounted && queryResult && (
        <QuickLookPanel
          mode="document"
          rawDocuments={queryResult.raw_documents}
          selectedRowIds={selectedRowIds}
          database={database}
          collection={collection}
          onClose={() => setShowQuickLook(false)}
        />
      )}
    </div>
  );
}
