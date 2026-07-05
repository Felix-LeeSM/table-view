import { useCallback, useMemo } from "react";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
import { cancelQueryNative } from "@lib/tauri";
import type { CancelError } from "@lib/tauri/cancel";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import type { ColumnInfo, SortInfo, TableData } from "@/types/schema";
import type { DocumentQueryResult } from "@/types/document";
import {
  type GridDataLoaderRunContext,
  useGridDataLoader,
} from "@hooks/useGridDataLoader";

/**
 * Read-flow plumbing for `DocumentDataGrid`. Supplies the `runFind`
 * dispatch (current pagination + `activeFilter`) and the mongo-native
 * `killOp` cancel step to the shared `useGridDataLoader`, which owns the
 * loading/error state, the `fetchIdRef` stale-response guard, and the
 * `queryIdRef` the threshold-overlay Cancel button routes through
 * `cancel_query`. Projects `DocumentQueryResult` to a `TableData`-shaped
 * surface so `useDataGridEdit` consumes it unchanged.
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

  const mongoSort = useMemo(() => toMongoSort(sorts), [sorts]);

  const runQuery = useCallback(
    async ({ queryId, isStale, setError }: GridDataLoaderRunContext) => {
      // The backend `find_documents` command registers the cancel token under
      // `queryId` and stamps the running op with `comment == queryId`
      // (Sprint 180 AC-180-04), which the native `killOp` step keys off.
      try {
        await runFind(
          connectionId,
          database,
          collection,
          {
            filter: activeFilterCount > 0 ? activeFilter : undefined,
            sort: mongoSort,
            projection:
              projection && Object.keys(projection).length > 0
                ? projection
                : undefined,
            skip: (page - 1) * pageSize,
            limit: pageSize,
          },
          queryId,
        );
      } catch (e) {
        if (!isStale()) setError(String(e));
      }
    },
    [
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
    ],
  );

  const cancelNative = useCallback(
    async (queryId: string) => {
      // Native `killOp` so a long collection scan actually stops on the server.
      // `find` stamped the op with `comment == queryId`, so the backend
      // resolves its opid via `$currentOp` and kills it (no client-visible pid
      // → `serverPid` unused, pass 0).
      try {
        await cancelQueryNative(connectionId, 0, queryId);
      } catch (err) {
        // Surface a genuine server rejection (no killop/inprog privilege on
        // Atlas shared, driver fault) so the Stop does not fail silently.
        // `AlreadyCompleted` is the common finished-before-click race → silent.
        const ce = err as CancelError;
        if (ce?.type === "PermissionDenied" || ce?.type === "NetworkError") {
          toast.error(
            i18n.t("document:gridCancel.nativeFailed", {
              message: ce.message,
            }),
          );
        }
      }
    },
    [connectionId],
  );

  const { loading, error, fetchData, handleCancelRefetch } = useGridDataLoader({
    runQuery,
    cancelNative,
  });

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
