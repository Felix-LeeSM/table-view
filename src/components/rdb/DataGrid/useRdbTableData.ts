import { useCallback, useEffect, useRef, useState } from "react";
import type { FilterCondition, SortInfo, TableData } from "@/types/schema";
import { cancelQuery, queryTableData } from "@lib/tauri";
import { parseDbMismatch } from "@lib/api/dbMismatch";
import { syncMismatchedActiveDb } from "@lib/api/syncMismatchedActiveDb";
import { recordHistoryEntry } from "@lib/history/recordHistoryEntry";
import { toast } from "@lib/toast";

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

  const fetchData = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

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
      if (fetchId === fetchIdRef.current) {
        setError(String(e));
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
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      }

      const message = e instanceof Error ? e.message : String(e);
      if (parseDbMismatch(message)) {
        void syncMismatchedActiveDb(connectionId, (actual) => {
          toast.warning(
            `Active DB synced to '${actual}'. Re-open the table to refresh.`,
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
    if (queryId) {
      cancelQuery(queryId).catch(() => {
        // Best effort: the backend may already have settled the refetch.
      });
    }
  }, []);

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
