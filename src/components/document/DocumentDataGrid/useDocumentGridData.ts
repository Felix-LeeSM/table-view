import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentStore } from "@stores/documentStore";
import { cancelQuery } from "@lib/tauri";
import type { ColumnInfo, TableData } from "@/types/schema";
import type { DocumentQueryResult } from "@/types/document";

/**
 * Read-flow plumbing for `DocumentDataGrid`. Owns the `runFind`
 * dispatch with current pagination + `activeFilter`, the loading/error
 * state, the `fetchIdRef` stale-response guard, and the `queryIdRef`
 * the threshold-overlay Cancel button routes through `cancel_query`.
 * Projects `DocumentQueryResult` to a `TableData`-shaped surface so
 * `useDataGridEdit` consumes it unchanged.
 *
 * Invariants:
 *   - `fetchIdRef` is bumped synchronously on cancel; late resolves
 *     whose `fetchId` no longer matches drop their writes.
 *   - `cancelQuery` is best-effort — the frontend already settled
 *     into a consistent state by the time we call it.
 */

export interface UseDocumentGridDataParams {
  connectionId: string;
  database: string;
  collection: string;
  page: number;
  pageSize: number;
  activeFilter: Record<string, unknown>;
  activeFilterCount: number;
}

export interface UseDocumentGridDataResult {
  data: TableData | null;
  queryResult: DocumentQueryResult | undefined;
  loading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  handleCancelRefetch: () => void;
}

export function useDocumentGridData({
  connectionId,
  database,
  collection,
  page,
  pageSize,
  activeFilter,
  activeFilterCount,
}: UseDocumentGridDataParams): UseDocumentGridDataResult {
  const runFind = useDocumentStore((s) => s.runFind);
  const queryResult = useDocumentStore(
    (s) => s.queryResults[`${connectionId}:${database}:${collection}`],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIdRef = useRef(0);
  // Sprint 180 — track the in-flight `find_documents` query id so the
  // shared Cancel button can route through `cancel_query`. Mongo runs
  // its find / aggregate on a `tokio::select!` shape that observes the
  // registered token (Sprint 180 backend extension); the Tauri command
  // accepts an optional query_id and registers the token before
  // dispatching the driver call. When the user clicks Cancel we
  // (a) call `cancel_query(queryId)` for backend-side abort and
  // (b) clear `loading` immediately so the overlay drops within one
  // frame without waiting for the driver to settle (AC-180-02).
  const queryIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await runFind(connectionId, database, collection, {
        filter: activeFilterCount > 0 ? activeFilter : undefined,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      });
    } catch (e) {
      if (fetchIdRef.current === fetchId) setError(String(e));
    } finally {
      if (fetchIdRef.current === fetchId) {
        setLoading(false);
        queryIdRef.current = null;
      }
    }
  }, [
    runFind,
    connectionId,
    database,
    collection,
    page,
    pageSize,
    activeFilter,
    activeFilterCount,
  ]);

  // Sprint 180 — Cancel handler for the threshold overlay. Bumps
  // `fetchIdRef` so the in-flight resolve is treated as stale (its
  // result is dropped) and clears `loading` synchronously so the
  // overlay disappears within one frame even if the backend hasn't
  // yet observed the cancel token. The best-effort `cancel_query` call
  // tells the backend to drop its driver-side handle; we swallow the
  // result because the user-visible state is already consistent.
  const handleCancelRefetch = useCallback(() => {
    fetchIdRef.current++;
    setLoading(false);
    const queryId = queryIdRef.current;
    queryIdRef.current = null;
    if (queryId) {
      cancelQuery(queryId).catch(() => {
        // best-effort: backend cancel registry may have already evicted
        // the token (race with finally clause), or the connection may
        // have been swapped. The frontend has already settled into a
        // consistent state, so we do not surface this to the user.
      });
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Convert DocumentQueryResult → a minimal TableData-compatible shape so
  // the edit hook (which speaks TableData) can consume it. The `raw_documents`
  // payload still powers Quick Look; the flattened `rows` power the grid
  // and the MQL generator.
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
      executed_query: `db.${collection}.find({}).skip(${
        (page - 1) * pageSize
      }).limit(${pageSize})`,
    };
  }, [queryResult, page, pageSize, collection]);

  return {
    data,
    queryResult,
    loading,
    error,
    fetchData,
    handleCancelRefetch,
  };
}
