/**
 * 작성 2026-05-17 (Phase 5 sprint-372) — backend-driven query history hook.
 *
 * Owns the read path that {@link useQueryHistoryStore} used to provide
 * via `entries` / `globalLog`. The store is being retired (sprint-373) so
 * the only authoritative source is now the backend `list_history` IPC
 * plus the `history.create` / `history.clear` cross-window events
 * routed through the sprint-365 dispatcher.
 *
 * Responsibilities:
 *   1. Initial mount → 1 IPC call (`listHistory(filter)`), populate `rows`.
 *   2. Cursor pagination — `loadMore()` appends the next page;
 *      `nextCursor === null` (no more rows) flips `hasMore` to false.
 *   3. Event reception:
 *      - `history.create` while paging through page 1 → refetch + prepend.
 *      - `history.create` while in cursor mode (page > 1) → refetch 0,
 *        flip `newEntryAvailable` flag so the UI can offer a "New entry"
 *        affordance (manual refresh).
 *      - `history.clear` → drop all rows, reset cursor + flags.
 *
 * Invariants (locked by `*.event-refetch.test.ts`):
 *   - 첫 page (`cursor === undefined`) 일 때만 자동 refetch.
 *   - cursor 가 set 된 상태(2 page 이상) 에서는 refetch skip, 배지 표시.
 *   - `history.clear` 는 cursor / mode 와 무관하게 항상 rows 비우고
 *     `newEntryAvailable=false` 로 리셋.
 *
 * 본 hook 의 wire shape (`listHistory({ connectionId, tabId, filter,
 * cursor, limit })`) 는 `src/lib/tauri/history.test.ts` (sprint-371) 의
 * mock 과 byte-equivalent — backend cargo integration test 와의 lego
 * contract.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  listHistory,
  type HistoryListRow,
  type HistoryQueryModeFilter,
  type ListHistoryRequest,
} from "@lib/tauri/history";
import { setStateChangedHandlers } from "@lib/events/stateChanged";
import { logger } from "@lib/logger";
import {
  QUERY_HISTORY_LOCAL_CREATED_EVENT,
  type QueryHistoryLocalCreatedDetail,
} from "@stores/queryHistoryStore";

/**
 * 호출자가 hook 에 넘기는 filter — `list_history` IPC 의 인자 shape.
 * `cursor` / `limit` 는 hook 이 내부 state 로 들고 있으므로 제외한다.
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
  /** Last `listHistory` 호출이 진행 중일 때 true. */
  loading: boolean;
  /** 마지막 IPC 호출이 실패했으면 reason; 새 호출에 reset. */
  error: string | null;
  /** 다음 page 가 있을 때 true (`nextCursor` 가 backend 응답에 존재). */
  hasMore: boolean;
  /**
   * cursor 모드 (`hasMore === true` 인 상태에서 `loadMore()` 한 이후) 일 때
   * 새 entry event 가 도착하면 true. `refresh()` 호출 시 false 로 reset.
   */
  newEntryAvailable: boolean;
  /** Cursor pagination — 다음 page 를 끝에 append. */
  loadMore: () => Promise<void>;
  /** 첫 page 부터 다시 fetch (event 수신 / 사용자 manual refresh). */
  refresh: () => Promise<void>;
}

/** 단일 page 의 default page size. */
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

  // `cursor` mode 추적 — `loadMore()` 가 호출되어 page > 1 상태일 때 true.
  // ref 로 보관해 event listener closure 가 stale 한 state 를 안 보게 한다.
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

  // Event wiring — sprint-365 dispatcher 의 history domain handlers 를
  // 본 hook 이 등록한다. Mount 마다 등록, unmount 시에는 그냥 둔다 —
  // setStateChangedHandlers 는 idempotent merge 이고 본 sprint 가 history
  // domain 의 유일한 consumer 라 등록 충돌 우려가 없다.
  useEffect(() => {
    setStateChangedHandlers({
      history: {
        onCreated: () => {
          // 첫 page 상태(cursor 미사용)면 refetch + prepend.
          // 페이지네이션 중이면 refetch skip + 배지.
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
          // version gap 도 결국 refetch 가 정답. 페이지네이션 상태와
          // 무관하게 첫 page 로 돌려서 truth 를 다시 잡는다.
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
