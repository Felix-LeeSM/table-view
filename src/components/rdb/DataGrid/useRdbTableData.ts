import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterCondition, SortInfo, TableData } from "@/types/schema";
import {
  cancelQuery,
  cancelQueryNative,
  getQueryServerPid,
  queryTableData,
} from "@lib/tauri";
import { useConnectionStore } from "@stores/connectionStore";
import { supportsNativeCancel } from "@components/query/QueryTab/useQueryContext";
import { getDbMismatchInfo, getTauriErrorMessage } from "@lib/tauri/error";
import { syncMismatchedActiveDb } from "@lib/runtime/recovery/syncMismatchedActiveDb";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";

interface UseRdbTableDataParams {
  connectionId: string;
  database: string;
  table: string;
  schema: string;
  page: number;
  pageSize: number;
  sorts: SortInfo[];
  appliedFilters: FilterCondition[];
  appliedRawSql: string;
}

export interface RdbTableDataState {
  data: TableData | null;
  loading: boolean;
  error: string | null;
  fetchData: () => Promise<void>;
  handleCancelRefetch: () => void;
}

export function useRdbTableData({
  connectionId,
  database,
  table,
  schema,
  page,
  pageSize,
  sorts,
  appliedFilters,
  appliedRawSql,
}: UseRdbTableDataParams): RdbTableDataState {
  const [data, setData] = useState<TableData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);
  const queryIdRef = useRef<string | null>(null);
  // Issue #1269 (P1) — native server-side cancel gates on the DBMS the browse
  // runs against (pg/mysql/mariadb `pg_cancel_backend`/`KILL QUERY`).
  const dbType = useConnectionStore(
    (s) => s.connections.find((c) => c.id === connectionId)?.dbType,
  );

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    // Issue #1269 (P1) — register a cancel-token id for this browse so the
    // overlay Cancel button can abort it (cooperative + native). The backend
    // `query_table_data` command registers the token under this id.
    const queryId = crypto.randomUUID();
    queryIdRef.current = queryId;

    const startedAt = Date.now();
    const previewSql = `SELECT * FROM ${schema ? `${schema}.` : ""}${table}`;

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
        activeRaw ? undefined : activeFilters,
        activeRaw,
        database,
        queryId,
      );

      if (fetchId === fetchIdRef.current) {
        setData(result);
        recordHistoryEntry({
          sql: previewSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          database,
          source: "sidebar-prefetch",
          rowsAffected: result?.rows?.length,
        });
      }
    } catch (e) {
      const message = getTauriErrorMessage(e);
      if (fetchId === fetchIdRef.current) {
        setError(message);
        recordHistoryEntry({
          sql: previewSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "rdb",
          queryMode: "sql",
          database,
          source: "sidebar-prefetch",
          errorMessage: message,
        });
      }

      if (getDbMismatchInfo(e)) {
        void syncMismatchedActiveDb(connectionId, (actual) => {
          toast.warning(
            i18n.t("rdb:useRdbTableData.activeDbSynced", { actual }),
          );
        });
      }
    }

    if (fetchId === fetchIdRef.current) {
      setLoading(false);
      queryIdRef.current = null;
    }
  }, [
    connectionId,
    database,
    table,
    schema,
    page,
    pageSize,
    sorts,
    appliedFilters,
    appliedRawSql,
  ]);

  const handleCancelRefetch = useCallback(() => {
    fetchIdRef.current++;
    setLoading(false);
    const queryId = queryIdRef.current;
    queryIdRef.current = null;
    if (!queryId) return;
    // Issue #1269 (P1) — mirror the SQL query tab's two-step cancel
    // (useQueryExecution). Fire the cooperative token FIRST so the backend
    // `tokio::select!` returns the canonical "cancelled" outcome, THEN, for a
    // native-cancel DBMS, tear down the actual server-side backend so a
    // long browse (big table scan) stops consuming server resources. Both
    // steps are best-effort: the UI already settled synchronously above.
    void (async () => {
      try {
        await cancelQuery(queryId);
      } catch {
        // Backend may already have settled the refetch (benign race).
      }
      if (!supportsNativeCancel(dbType)) return;
      try {
        const serverPid = await getQueryServerPid(queryId);
        if (serverPid != null) {
          await cancelQueryNative(connectionId, serverPid);
        }
      } catch {
        // Native cancel is best-effort — query likely already completed.
      }
    })();
  }, [connectionId, dbType]);

  useEffect(() => {
    const handler = () => {
      void fetchData();
    };
    window.addEventListener("refresh-data", handler);
    return () => window.removeEventListener("refresh-data", handler);
  }, [fetchData]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, fetchData, handleCancelRefetch };
}
