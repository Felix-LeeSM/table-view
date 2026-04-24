import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useDocumentStore } from "@stores/documentStore";
import type { ColumnInfo, TableData } from "@/types/schema";

interface DocumentDataGridProps {
  connectionId: string;
  database: string;
  collection: string;
}

const DEFAULT_PAGE_SIZE = 300;

/**
 * Sprint 66 — P0 read-only grid for document-paradigm tabs.
 *
 * Intentionally minimal: it fetches via `useDocumentStore.runFind`, renders
 * the flattened rows in a plain HTML table, and surfaces pagination via
 * `skip` + `limit`. Composite cells (`"{...}"` / `"[N items]"`) render as
 * muted text so the user knows the value is a sentinel rather than a raw
 * string. Editing, filtering, and Quick Look are deliberately deferred to
 * Sprint 67+ — this component's purpose is to prove the read path works
 * end-to-end against the new adapter wiring.
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
            className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-50"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span className="text-[11px] text-muted-foreground">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="rounded border border-border px-2 py-0.5 text-[11px] disabled:opacity-50"
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
                    <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {col.data_type}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIdx) => (
                <tr
                  key={`row-${page}-${rowIdx}`}
                  className="border-b border-border hover:bg-muted"
                >
                  {data.columns.map((col, colIdx) => {
                    const cell = (row as unknown[])[colIdx];
                    const isSentinel =
                      typeof cell === "string" &&
                      (cell === "{...}" || /^\[\d+ items\]$/.test(cell));
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
              ))}
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
    </div>
  );
}
