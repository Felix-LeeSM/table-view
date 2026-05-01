import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Info, Loader2, Pencil } from "lucide-react";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
  QueryType,
} from "@/types/query";
import { truncateCell } from "@lib/format";
import {
  analyzeResultEditability,
  parseSingleTableSelect,
} from "@lib/queryAnalyzer";
import { useSchemaStore } from "@stores/schemaStore";
import CellDetailDialog from "@components/datagrid/CellDetailDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { ExportButton } from "@components/shared/ExportButton";
import type { ExportContext, ExportFormat } from "@/lib/tauri";
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
                <div className="mt-0.5 text-3xs text-muted-foreground">
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

  const exportContext: ExportContext = {
    kind: "query",
    source_table: parsed ? { schema: parsed.schema, name: parsed.table } : null,
  };
  const disabledExportFormats: ExportFormat[] = parsed ? [] : ["sql"];

  const exportButton = (
    <ExportButton
      context={exportContext}
      headers={result.columns.map((c) => c.name)}
      getRows={() => result.rows as unknown[][]}
      disabledFormats={disabledExportFormats}
    />
  );

  if (editability && editability.editable) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 border-b border-border bg-success/10 px-3 py-0.5 text-xs text-success">
          <span className="flex items-center gap-1.5">
            <Pencil size={12} />
            <span>
              Editable — double-click a cell to edit, right-click for delete
            </span>
          </span>
          {exportButton}
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
      {editability ? (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-0.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Info size={12} />
            <span>Read-only — {editability.reason}</span>
          </span>
          {exportButton}
        </div>
      ) : (
        <div className="flex items-center justify-end gap-2 border-b border-border px-2 py-0.5">
          {exportButton}
        </div>
      )}
      <ResultTable result={result} />
    </>
  );
}

/**
 * Renders the existing single-result UI (status bar + select/dml/ddl
 * content). Extracted so the multi-statement Tabs view can reuse the
 * exact same per-statement rendering as the legacy single-statement path.
 */
function CompletedSingleResult({
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
      {typeof result.query_type === "object" && "dml" in result.query_type && (
        <DmlMessage result={result} />
      )}
      {result.query_type === "ddl" && <DdlMessage />}
    </div>
  );
}

/** Verb label shown in each multi-statement tab trigger. */
function statementVerb(stmt: QueryStatementResult): string {
  if (stmt.status === "error") return "ERROR";
  if (stmt.result) return queryTypeLabel(stmt.result.query_type);
  return "Query";
}

/**
 * Trigger badge: "{rows} rows" / "{ms} ms" for success, "✕" for error.
 * SELECT shows row count; DML/DDL show wall-clock duration.
 */
function statementBadge(stmt: QueryStatementResult): string {
  if (stmt.status === "error") return "✕";
  if (!stmt.result) return `${stmt.durationMs} ms`;
  if (stmt.result.query_type === "select") {
    const n = stmt.result.total_count;
    return `${n.toLocaleString()} row${n !== 1 ? "s" : ""}`;
  }
  return `${stmt.durationMs} ms`;
}

/**
 * Renders the Radix Tabs view for a multi-statement completion. Each
 * trigger shows "Statement {n} {verb}" + a row/ms or ✕ badge; failing
 * statements get `data-status="error"` and a destructive Tailwind tone
 * so users can spot partial failures at a glance.
 *
 * Keyboard nav (`ArrowLeft` / `ArrowRight` / `Home` / `End`) is provided
 * by Radix's default `TabsList` behavior with `activationMode="automatic"`.
 */
function CompletedMultiResult({
  statements,
  connectionId,
  onAfterCommit,
}: {
  statements: QueryStatementResult[];
  connectionId?: string;
  onAfterCommit?: () => void;
}) {
  return (
    <Tabs
      defaultValue="stmt-0"
      activationMode="automatic"
      className="flex flex-1 flex-col overflow-hidden"
    >
      <TabsList
        className="shrink-0 gap-0 border-b border-border bg-secondary px-1"
        aria-label="Statement results"
      >
        {statements.map((stmt, idx) => {
          const isError = stmt.status === "error";
          return (
            <TabsTrigger
              key={`stmt-trigger-${idx}`}
              value={`stmt-${idx}`}
              data-status={isError ? "error" : "success"}
              className={
                isError
                  ? "text-destructive data-[state=active]:border-destructive data-[state=active]:text-destructive"
                  : ""
              }
            >
              <span className="flex items-center gap-1.5">
                {isError && <AlertTriangle size={12} aria-hidden="true" />}
                <span>
                  Statement {idx + 1} {statementVerb(stmt)}
                </span>
                <span
                  className={
                    "ml-1 rounded px-1.5 py-0.5 font-mono text-3xs " +
                    (isError
                      ? "bg-destructive/15 text-destructive"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {statementBadge(stmt)}
                </span>
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {statements.map((stmt, idx) => (
        <TabsContent
          key={`stmt-content-${idx}`}
          value={`stmt-${idx}`}
          className="flex flex-1 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          {stmt.status === "error" || !stmt.result ? (
            <div
              role="alert"
              className="border-b border-border bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <div className="font-medium">Statement {idx + 1} failed</div>
              <div className="mt-1 whitespace-pre-wrap text-xs">
                {stmt.error ?? "Unknown error"}
              </div>
            </div>
          ) : (
            <CompletedSingleResult
              result={stmt.result}
              connectionId={connectionId}
              sql={stmt.sql}
              onAfterCommit={onAfterCommit}
            />
          )}
        </TabsContent>
      ))}
    </Tabs>
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
    // Sprint 100 — multi-statement runs (≥ 2 statements) split into one
    // tab per statement. Single-statement runs (or any caller that omits
    // `statements`) keep rendering the legacy single-result UI for full
    // backward compat — no Tabs scaffolding is rendered, so existing
    // tests that assert `queryByRole("tab") === null` still pass.
    if (queryState.statements && queryState.statements.length >= 2) {
      return (
        <CompletedMultiResult
          statements={queryState.statements}
          connectionId={connectionId}
          onAfterCommit={onAfterCommit}
        />
      );
    }
    return (
      <CompletedSingleResult
        result={queryState.result}
        connectionId={connectionId}
        sql={sql}
        onAfterCommit={onAfterCommit}
      />
    );
  }

  // Idle state — prompt the user
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Press Cmd+Return to execute the query</p>
    </div>
  );
}
