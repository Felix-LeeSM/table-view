/**
 * Written 2026-05-17 (state-management-strategy Phase 5) — backend-driven
 * query history hook.
 *
 * Owns the read path that {@link useQueryHistoryStore} used to provide
 * via `entries` / `globalLog`. Those fields are retired (the store is now a
 * thin wrapper), so the only authoritative source is the backend
 * `list_history` IPC plus the `history.create` / `history.clear`
 * cross-window events routed through the state-changed dispatcher
 * (`@lib/events/stateChanged`).
 *
 * Responsibilities:
 *   1. Initial mount → 1 IPC call (`listHistory(filter)`), populate `rows`.
 *   2. Cursor pagination — `loadMore()` appends the next page; a missing
 *      `nextCursor` (no more rows) flips `hasMore` to false.
 *   3. Event reception:
 *      - `history.create` while paging through page 1 → refetch + prepend.
 *      - `history.create` while in cursor mode (page > 1) → refetch 0,
 *        flip `newEntryAvailable` flag so the UI can offer a "New entry"
 *        affordance (manual refresh).
 *      - `history.clear` → drop all rows, reset cursor + flags.
 *
 * Invariants (locked by `*.event-refetch.test.ts`):
 *   - A new-entry event auto-refetches only on the first page
 *     (`cursor === undefined`).
 *   - With a cursor set (page 2 or later), a new-entry event skips the
 *     refetch and shows the badge.
 *   - `history.clear` always empties rows and resets
 *     `newEntryAvailable=false`, regardless of cursor / mode.
 *
 * This hook's wire shape (`listHistory({ connectionId, tabId, filter,
 * cursor, limit })`) is byte-equivalent to the mock in
 * `src/lib/tauri/history.test.ts` — an interlocking contract with the
 * backend cargo integration test.
 */

import { setStateChangedHandlers } from "@lib/events/stateChanged";
import { logger } from "@lib/logger";
import {
  type HistoryListRow,
  type HistoryQueryModeFilter,
  type ListHistoryRequest,
  listHistory,
} from "@lib/tauri/history";
import {
  QUERY_HISTORY_LOCAL_CREATED_EVENT,
  type QueryHistoryLocalCreatedDetail,
} from "@stores/queryHistoryStore";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The filter callers pass to the hook — the `list_history` IPC argument
 * shape. `cursor` is excluded because the hook keeps it as internal state.
 */
export interface UseQueryHistoryFilter {
  connectionId?: string;
  tabId?: string;
  filter?: HistoryQueryModeFilter;
  limit?: number;
  /**
   * Optional read gate for hidden dock panels. Defaults to enabled so
   * always-visible callers keep the original mount-time fetch behavior.
   */
  enabled?: boolean;
}

export interface UseQueryHistoryResult {
  rows: HistoryListRow[];
  /** True while the last `listHistory` call is in flight. */
  loading: boolean;
  /** The reason if the last IPC call failed; reset on a new call. */
  error: string | null;
  /** True when a next page exists (the backend returned `nextCursor`). */
  hasMore: boolean;
  /**
   * True when a new-entry event arrives in cursor mode (after `loadMore()`
   * ran while `hasMore === true`). A `refresh()` call resets it to false.
   */
  newEntryAvailable: boolean;
  /** Cursor pagination — appends the next page at the end. */
  loadMore: () => Promise<void>;
  /** Fetches again from the first page (on an event / a manual refresh). */
  refresh: () => Promise<void>;
}

/** Default size of a single page. */
const DEFAULT_LIMIT = 100;

function rowMatchesFilter(
  row: HistoryListRow,
  filter: UseQueryHistoryFilter,
): boolean {
  if (
    filter.connectionId !== undefined &&
    row.connectionId !== filter.connectionId
  ) {
    return false;
  }
  if (filter.tabId !== undefined && (row.tabId ?? undefined) !== filter.tabId) {
    return false;
  }
  if (filter.filter !== undefined) {
    if (row.paradigm !== filter.filter.paradigm) return false;
    if (
      filter.filter.queryMode !== undefined &&
      row.queryMode !== filter.filter.queryMode
    ) {
      return false;
    }
  }
  return true;
}

export function useQueryHistory(
  filterArg: UseQueryHistoryFilter,
): UseQueryHistoryResult {
  const enabled = filterArg.enabled ?? true;
  const [rows, setRows] = useState<HistoryListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<number | undefined>(undefined);
  const [newEntryAvailable, setNewEntryAvailable] = useState(false);

  // Tracks `cursor` mode — true once `loadMore()` has run and page > 1.
  // Kept in a ref so the event listener closure does not read stale state.
  const inCursorModeRef = useRef(false);
  const lastFilterRef = useRef<UseQueryHistoryFilter>(filterArg);
  lastFilterRef.current = filterArg;

  const buildRequest = useCallback((cursor?: number): ListHistoryRequest => {
    const f = lastFilterRef.current;
    const req: ListHistoryRequest = {};
    if (f.connectionId !== undefined) req.connectionId = f.connectionId;
    if (f.tabId !== undefined) req.tabId = f.tabId;
    if (f.filter !== undefined) req.filter = f.filter;
    if (cursor !== undefined) req.cursor = cursor;
    req.limit = f.limit ?? DEFAULT_LIMIT;
    return req;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    if (!(lastFilterRef.current.enabled ?? true)) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await listHistory(buildRequest(undefined));
      setRows(resp.rows);
      setNextCursor(resp.nextCursor);
      inCursorModeRef.current = false;
      setNewEntryAvailable(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      logger.warn("[useQueryHistory] refresh failed", msg);
    } finally {
      setLoading(false);
    }
  }, [buildRequest]);

  const loadMore = useCallback(async (): Promise<void> => {
    if (!(lastFilterRef.current.enabled ?? true)) return;
    if (nextCursor === undefined) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await listHistory(buildRequest(nextCursor));
      setRows((prev) => [...prev, ...resp.rows]);
      setNextCursor(resp.nextCursor);
      inCursorModeRef.current = true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      logger.warn("[useQueryHistory] loadMore failed", msg);
    } finally {
      setLoading(false);
    }
  }, [buildRequest, nextCursor]);

  // Initial/enabled mount — 1 IPC. Hidden dock panels pass enabled=false so
  // opening the panel fetches fresh backend truth instead of showing stale
  // rows captured while the panel was not visible.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    // `refresh` is omitted intentionally — fire only on the enabled transition
    // (panel open), not on every `refresh` identity change, which would
    // re-issue the list IPC on each dependency churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Event wiring — this hook registers the history domain handlers of the
  // state-changed dispatcher. It registers on every mount and leaves them in
  // place on unmount: setStateChangedHandlers is an idempotent merge and this
  // hook is the only consumer of the history domain. With several mounted
  // instances, the latest registration replaces the earlier handlers.
  useEffect(() => {
    setStateChangedHandlers({
      history: {
        onCreated: () => {
          // On the first page (no cursor): refetch + prepend.
          // While paginating: skip the refetch + set the badge.
          if (inCursorModeRef.current) {
            setNewEntryAvailable(true);
            return;
          }
          void refresh();
        },
        onClear: () => {
          setRows([]);
          setNextCursor(undefined);
          inCursorModeRef.current = false;
          setNewEntryAvailable(false);
        },
        onGapDetected: () => {
          // A version gap is also answered by a refetch. Regardless of the
          // pagination state, go back to the first page to re-establish truth.
          void refresh();
        },
      },
    });
  }, [refresh]);

  useEffect(() => {
    const onLocalCreated = (event: Event) => {
      const detail = (event as CustomEvent<QueryHistoryLocalCreatedDetail>)
        .detail;
      if (
        !detail?.row ||
        !rowMatchesFilter(detail.row, lastFilterRef.current)
      ) {
        return;
      }
      if (inCursorModeRef.current) {
        setNewEntryAvailable(true);
        return;
      }
      void refresh();
    };
    window.addEventListener(QUERY_HISTORY_LOCAL_CREATED_EVENT, onLocalCreated);
    return () => {
      window.removeEventListener(
        QUERY_HISTORY_LOCAL_CREATED_EVENT,
        onLocalCreated,
      );
    };
  }, [refresh]);

  return {
    rows,
    loading,
    error,
    hasMore: nextCursor !== undefined,
    newEntryAvailable,
    loadMore,
    refresh,
  };
}
