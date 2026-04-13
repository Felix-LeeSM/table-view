import { Loader2 } from "lucide-react";
import type { QueryResult, QueryState, QueryType } from "../types/query";
import { truncateCell } from "../lib/format";

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

function ResultTable({ result }: { result: QueryResult }) {
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
              {row.map((cell, cellIdx) => (
                <td
                  key={cellIdx}
                  className="overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground"
                  title={formatCell(cell)}
                >
                  {cell == null ? (
                    <span className="italic text-muted-foreground">NULL</span>
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
                className="px-3 py-4 text-center text-xs text-muted-foreground"
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

export default function QueryResultGrid({ queryState }: QueryResultGridProps) {
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
        {result.query_type === "select" && <ResultTable result={result} />}
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
