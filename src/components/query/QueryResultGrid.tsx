import { useEffect, useMemo, useState } from "react";
import { Info, Loader2, Pencil } from "lucide-react";
import type { QueryResult, QueryState, QueryType } from "@/types/query";
import { truncateCell } from "@lib/format";
import {
  analyzeResultEditability,
  parseSingleTableSelect,
} from "@lib/queryAnalyzer";
import { useSchemaStore } from "@stores/schemaStore";
import CellDetailDialog from "@components/datagrid/CellDetailDialog";
import EditableQueryResultGrid from "./EditableQueryResultGrid";

interface QueryResultGridProps {
  queryState: QueryState;
  /** Connection used to look up PK metadata and run edit statements. */
  connectionId?: string;
  /** SQL of the executed query — used to detect a single-table SELECT. */
  sql?: string;
  /** Called after a raw-result edit is committed so the parent can refresh. */
  onAfterCommit?: () => void;
}

/** Human-readable label for a QueryType value. */
function queryTypeLabel(qt: QueryType): string {
  if (qt === "select") return "SELECT";
  if (qt === "ddl") return "DDL";
  if (typeof qt === "object" && "dml" in qt) return "DML";
  return "Query";
}

/** Format a cell value for display. */
function formatCell(cell: unknown): string {
  if (cell == null) return "NULL";
  if (typeof cell === "object" && cell !== null) {
    return JSON.stringify(cell, null, 2);
  }
  return String(cell);
}

function ResultTable({ result }: { result: QueryResult }) {
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-secondary">
          <tr>
            {result.columns.map((col) => (
              <th
                key={col.name}
                scope="col"
                className="border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
              >
                <div>{col.name}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {col.data_type}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIdx) => (
            <tr
              key={`row-${rowIdx}`}
              className="border-b border-border hover:bg-muted"
            >
              {row.map((cell, cellIdx) => {
                const col = result.columns[cellIdx];
                return (
                  <td
                    key={cellIdx}
                    className="overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground cursor-pointer"
                    title={`${formatCell(cell)}\n\n(double-click to expand)`}
                    onDoubleClick={() => {
                      if (col) {
                        setCellDetail({
                          data: cell,
                          columnName: col.name,
                          dataType: col.data_type,
                        });
                      }
                    }}
                  >
                    {cell == null ? (
                      <span className="italic text-muted-foreground">NULL</span>
                    ) : (
                      <span className="line-clamp-3">
                        {truncateCell(formatCell(cell))}
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td
                colSpan={result.columns.length || 1}
                className="px-3 py-4 text-center text-xs text-muted-foreground"
              >
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {cellDetail && (
        <CellDetailDialog
          open={cellDetail !== null}
          onOpenChange={(open) => {
            if (!open) setCellDetail(null);
          }}
          data={cellDetail.data}
          columnName={cellDetail.columnName}
          dataType={cellDetail.dataType}
        />
      )}
    </div>
  );
}

function DmlMessage({ result }: { result: QueryResult }) {
  const qt = result.query_type;
  const rowsAffected =
    typeof qt === "object" && "dml" in qt
      ? qt.dml.rows_affected
      : result.total_count;
  return (
    <div className="flex items-center justify-center py-8 text-sm text-secondary-foreground">
      {rowsAffected.toLocaleString()} row{rowsAffected !== 1 ? "s" : ""}{" "}
      affected
    </div>
  );
}

function DdlMessage() {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-secondary-foreground">
      Query executed successfully
    </div>
  );
}

/**
 * Wrapper that decides whether the SELECT result is editable, fetches the
 * needed PK metadata, and renders either the editable grid + a green
 * "Editable" badge or the read-only table + an info banner explaining why
 * editing isn't available.
 */
function SelectResultArea({
  result,
  connectionId,
  sql,
  onAfterCommit,
}: {
  result: QueryResult;
  connectionId?: string;
  sql?: string;
  onAfterCommit?: () => void;
}) {
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);

  // Identify the source table once per SQL so we can fetch + look up its
  // primary-key metadata. Resolution falls back to "public" because that's
  // the default schema in PostgreSQL.
  const parsed = useMemo(() => {
    if (!sql) return null;
    const info = parseSingleTableSelect(sql);
    if (!info) return null;
    return { schema: info.schema ?? "public", table: info.table };
  }, [sql]);

  useEffect(() => {
    if (!parsed || !connectionId) return;
    const cacheKey = `${connectionId}:${parsed.schema}:${parsed.table}`;
    if (!tableColumnsCache[cacheKey]) {
      getTableColumns(connectionId, parsed.table, parsed.schema).catch(() => {
        // If the lookup fails we leave the cache empty; the editability
        // analyser surfaces this as "Loading column metadata…".
      });
    }
  }, [parsed, connectionId, tableColumnsCache, getTableColumns]);

  const tableColumns = useMemo(() => {
    if (!parsed || !connectionId) return null;
    const cacheKey = `${connectionId}:${parsed.schema}:${parsed.table}`;
    return tableColumnsCache[cacheKey] ?? null;
  }, [parsed, connectionId, tableColumnsCache]);

  const editability = useMemo(
    () =>
      sql ? analyzeResultEditability(sql, result.columns, tableColumns) : null,
    [sql, result.columns, tableColumns],
  );

  if (editability && editability.editable) {
    return (
      <>
        <div className="flex items-center gap-1.5 border-b border-border bg-success/10 px-3 py-1 text-xs text-success">
          <Pencil size={12} />
          <span>
            Editable — double-click a cell to edit, right-click for delete
          </span>
        </div>
        <EditableQueryResultGrid
          result={result}
          connectionId={connectionId!}
          plan={{
            schema: editability.schema,
            table: editability.table,
            pkColumns: editability.pkColumns,
            resultColumnNames: editability.resultToColumnName,
          }}
          onAfterCommit={onAfterCommit}
        />
      </>
    );
  }

  return (
    <>
      {editability && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
          <Info size={12} />
          <span>Read-only — {editability.reason}</span>
        </div>
      )}
      <ResultTable result={result} />
    </>
  );
}

export default function QueryResultGrid({
  queryState,
  connectionId,
  sql,
  onAfterCommit,
}: QueryResultGridProps) {
  // Running state
  if (queryState.status === "running") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Loader2
          className="mb-2 animate-spin text-muted-foreground"
          size={24}
        />
        <p className="text-sm text-muted-foreground">Executing query...</p>
      </div>
    );
  }

  // Error state
  if (queryState.status === "error") {
    return (
      <div className="flex flex-1 flex-col">
        <div
          role="alert"
          className="border-b border-border bg-muted px-3 py-2 text-sm text-destructive"
        >
          {queryState.error}
        </div>
      </div>
    );
  }

  // Completed state
  if (queryState.status === "completed") {
    const { result } = queryState;
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Status bar */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-secondary-foreground">
          <span>
            {queryTypeLabel(result.query_type)}
            {result.query_type === "select" && (
              <>
                {" "}
                &mdash; {result.total_count.toLocaleString()} row
                {result.total_count !== 1 ? "s" : ""}
              </>
            )}
          </span>
          <span className="text-muted-foreground">
            {result.execution_time_ms} ms
          </span>
        </div>

        {/* Content */}
        {result.query_type === "select" && (
          <SelectResultArea
            result={result}
            connectionId={connectionId}
            sql={sql}
            onAfterCommit={onAfterCommit}
          />
        )}
        {typeof result.query_type === "object" &&
          "dml" in result.query_type && <DmlMessage result={result} />}
        {result.query_type === "ddl" && <DdlMessage />}
      </div>
    );
  }

  // Idle state — prompt the user
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Press Cmd+Return to execute the query</p>
    </div>
  );
}
