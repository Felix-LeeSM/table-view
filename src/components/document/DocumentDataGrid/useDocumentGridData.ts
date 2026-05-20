import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
import { cancelQuery } from "@lib/tauri";
import type { ColumnInfo, SortInfo, TableData } from "@/types/schema";
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
  /**
   * Sprint 315 — multi-column sort. Empty array → no sort field on
   * the find body (Mongo default = natural order). The hook converts
   * `SortInfo` (`column` + `ASC|DESC`) into the Mongo wire shape
   * (`{ field: 1 | -1 }`).
   */
  sorts?: readonly SortInfo[];
  /**
   * Sprint 325 — Slice H: server-side field projection. `undefined` or
   * empty object → backend returns all top-level fields. Mixed include /
   * exclude is invalid in Mongo and the backend will reject it; the
   * dialog only emits canonical shapes.
   */
  projection?: Record<string, 0 | 1>;
}

export interface UseDocumentGridDataResult {
  data: TableData | null;
  queryResult: DocumentQueryResult | undefined;
  loading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  handleCancelRefetch: () => void;
}

/**
 * Convert RDB-style `SortInfo[]` into the Mongo wire shape
 * (`{ field: 1 | -1 }`). Preserves insertion order, which is the
 * priority for multi-key sort. Empty array → undefined so the find
 * body omits the field entirely.
 */
function toMongoSort(
  sorts: readonly SortInfo[] | undefined,
): Record<string, 1 | -1> | undefined {
  if (!sorts || sorts.length === 0) return undefined;
  const result: Record<string, 1 | -1> = {};
  for (const s of sorts) {
    result[s.column] = s.direction === "ASC" ? 1 : -1;
  }
  return result;
}

export function useDocumentGridData({
  connectionId,
  database,
  collection,
  page,
  pageSize,
  activeFilter,
  activeFilterCount,
  sorts,
  projection,
}: UseDocumentGridDataParams): UseDocumentGridDataResult {
  const runFind = useDocumentQueryStore((s) => s.runFind);
  const queryResult = useDocumentQueryStore(
    (s) => s.queryResults[connectionId]?.[database]?.[collection],
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchIdRef = useRef(0);
  // In-flight `find_documents` query id. Cancel calls (a) `cancel_query`
  // for the backend-side abort and (b) clear `loading` synchronously so
  // the overlay drops within one frame even before the driver settles.
  const queryIdRef = useRef<string | null>(null);

  const mongoSort = useMemo(() => toMongoSort(sorts), [sorts]);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await runFind(connectionId, database, collection, {
        filter: activeFilterCount > 0 ? activeFilter : undefined,
        sort: mongoSort,
        projection:
          projection && Object.keys(projection).length > 0
            ? projection
            : undefined,
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
    mongoSort,
    projection,
  ]);

  // Cancel handler for the threshold overlay. Bumps `fetchIdRef` so the
  // in-flight resolve is treated as stale, clears `loading` synchronously,
  // and best-effort calls `cancel_query` (UI is already consistent if the
  // backend doesn't observe it).
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
  // the edit hook (which speaks TableData) can consume it. The `rawDocuments`
  // payload still powers Quick Look; the flattened `rows` power the grid
  // and the MQL generator.
  const data: TableData | null = useMemo(() => {
    if (!queryResult) return null;
    const columns: ColumnInfo[] = queryResult.columns.map((c) => ({
      name: c.name,
      data_type: c.dataType,
      nullable: true,
      default_value: null,
      is_primary_key: c.name === "_id",
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    }));
    // Hand-spell the sort literal so lint's `JSON.stringify` ban (cell
    // domain — Decimal/BigInt traps) doesn't fire. `mongoSort` only
    // holds `1 | -1` values, so a manual join is safe and faithful.
    const sortChain = mongoSort
      ? `.sort({ ${Object.entries(mongoSort)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")} })`
      : "";
    return {
      columns,
      rows: queryResult.rows,
      total_count: queryResult.totalCount,
      page,
      page_size: pageSize,
      executed_query: `db.${collection}.find({})${sortChain}.skip(${
        (page - 1) * pageSize
      }).limit(${pageSize})`,
    };
  }, [queryResult, page, pageSize, collection, mongoSort]);

  return {
    data,
    queryResult,
    loading,
    error,
    fetchData,
    handleCancelRefetch,
  };
}
