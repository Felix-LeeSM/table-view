import { Loader2 } from "lucide-react";
import type { QueryResult, QueryState, QueryType } from "../types/query";

interface QueryResultGridProps {
  queryState: QueryState;
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

/** Truncate long cell values for display. */
function truncateCell(value: string, limit: number = 200): string {
  if (value.length <= limit) return value;
  return value.slice(0, limit) + "...";
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-(--color-bg-secondary)">
          <tr>
            {result.columns.map((col) => (
              <th
                key={col.name}
                scope="col"
                className="border-b border-r border-(--color-border) px-3 py-1.5 text-left text-xs font-medium text-(--color-text-secondary)"
              >
                <div>{col.name}</div>
                <div className="mt-0.5 text-[10px] text-(--color-text-muted)">
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
              className="border-b border-(--color-border) hover:bg-(--color-bg-tertiary)"
            >
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="overflow-hidden border-r border-(--color-border) px-3 py-1 text-xs text-(--color-text-primary)"
                  title={formatCell(cell)}
                >
                  {cell == null ? (
                    <span className="italic text-(--color-text-muted)">
                      NULL
                    </span>
                  ) : (
                    <span className="line-clamp-3">
                      {truncateCell(formatCell(cell))}
                    </span>
                  )}
                </td>
              ))}
            </tr>
          ))}
          {result.rows.length === 0 && (
            <tr>
              <td
                colSpan={result.columns.length || 1}
                className="px-3 py-4 text-center text-xs text-(--color-text-muted)"
              >
                No data
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
    <div className="flex items-center justify-center py-8 text-sm text-(--color-text-secondary)">
      {rowsAffected.toLocaleString()} row{rowsAffected !== 1 ? "s" : ""}{" "}
      affected
    </div>
  );
}

function DdlMessage() {
  return (
    <div className="flex items-center justify-center py-8 text-sm text-(--color-text-secondary)">
      Query executed successfully
    </div>
  );
}

export default function QueryResultGrid({ queryState }: QueryResultGridProps) {
  // Running state
  if (queryState.status === "running") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Loader2
          className="mb-2 animate-spin text-(--color-text-muted)"
          size={24}
        />
        <p className="text-sm text-(--color-text-muted)">Executing query...</p>
      </div>
    );
  }

  // Error state
  if (queryState.status === "error") {
    return (
      <div className="flex flex-1 flex-col">
        <div
          role="alert"
          className="border-b border-(--color-border) bg-(--color-bg-tertiary) px-3 py-2 text-sm text-(--color-danger)"
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
        <div className="flex items-center justify-between border-b border-(--color-border) px-3 py-1.5 text-xs text-(--color-text-secondary)">
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
          <span className="text-(--color-text-muted)">
            {result.execution_time_ms} ms
          </span>
        </div>

        {/* Content */}
        {result.query_type === "select" && <ResultTable result={result} />}
        {typeof result.query_type === "object" &&
          "dml" in result.query_type && <DmlMessage result={result} />}
        {result.query_type === "ddl" && <DdlMessage />}
      </div>
    );
  }

  // Idle state — prompt the user
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-(--color-text-muted)">
      <p className="text-sm">Press Cmd+Return to execute the query</p>
    </div>
  );
}
