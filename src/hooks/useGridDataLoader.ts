import { useCallback, useEffect, useRef, useState } from "react";
import { cancelQuery } from "@lib/tauri";

/**
 * Shared read-flow plumbing for grid browses (rdb `useRdbTableData`,
 * document `useDocumentGridData`). Owns the loading/error state, the
 * `fetchIdRef` stale-response guard, the `queryIdRef` cancel token, and the
 * two-step Cancel sequence. The data source (rdb `query_table_data` vs mongo
 * `find_documents`) is injected via `runQuery` / `cancelNative` so only the
 * wire call differs, never the cancel/stale contract.
 *
 * Invariants:
 *   - `fetchIdRef` is bumped synchronously on every fetch and on cancel; a
 *     late resolve whose `fetchId` no longer matches (`isStale()`) drops its
 *     writes so a cancelled/superseded browse never ghost-writes.
 *   - Cancel clears `loading` synchronously so the overlay drops within one
 *     frame even before the backend settles.
 */

export interface GridDataLoaderRunContext {
  /** Cancel-token id registered with the backend for this browse. */
  queryId: string;
  /** True once a newer fetch or a cancel has superseded this browse. */
  isStale: () => boolean;
  setError: (message: string | null) => void;
}

export interface UseGridDataLoaderParams {
  /**
   * Source-specific browse dispatch. Must guard its own writes with
   * `isStale()` and report failures via `setError` (both from the context).
   */
  runQuery: (ctx: GridDataLoaderRunContext) => Promise<void>;
  /**
   * Paradigm-native cancel step, fired AFTER the cooperative `cancelQuery`.
   * rdb resolves a server pid + `cancelQueryNative`; mongo `killOp`s by tag.
   */
  cancelNative: (queryId: string) => Promise<void>;
}

export interface GridDataLoaderState {
  loading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  handleCancelRefetch: () => void;
}

export function useGridDataLoader({
  runQuery,
  cancelNative,
}: UseGridDataLoaderParams): GridDataLoaderState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);
  const queryIdRef = useRef<string | null>(null);

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);
    // Issue #1269 (P1) — register a cancel-token id so the overlay Cancel
    // button can abort this browse (cooperative + native). The backend browse
    // command registers the token under this id.
    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;
    const isStale = () => fetchId !== fetchIdRef.current;
    try {
      await runQuery({ queryId, isStale, setError });
    } finally {
      if (!isStale()) {
        setLoading(false);
        queryIdRef.current = null;
      }
    }
  }, [runQuery]);

  const handleCancelRefetch = useCallback(() => {
    fetchIdRef.current++;
    setLoading(false);
    const queryId = queryIdRef.current;
    queryIdRef.current = null;
    if (!queryId) return;
    // Issue #1269 (P1) — two-step cancel mirroring the SQL query tab
    // (useQueryExecution). Fire the cooperative token FIRST so the backend
    // `tokio::select!` returns the canonical "cancelled" outcome and frees the
    // driver, THEN the paradigm-native tear-down so a long scan actually stops
    // consuming server resources. Both steps are best-effort: the UI already
    // settled synchronously above.
    void (async () => {
      try {
        await cancelQuery(queryId);
      } catch {
        // Backend may already have settled the refetch (benign race).
      }
      await cancelNative(queryId);
    })();
  }, [cancelNative]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { loading, error, fetchData, handleCancelRefetch };
}
