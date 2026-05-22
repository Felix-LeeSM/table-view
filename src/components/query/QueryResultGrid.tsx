import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Decimal from "decimal.js";
import { AlertTriangle, Info, Loader2, Pencil } from "lucide-react";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
  QueryType,
} from "@/types/query";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useColumnResize } from "@components/datagrid/DataGridTable/useColumnResize";
import { getDefaultRem } from "@/lib/columnCategory";
import {
  analyzeResultEditability,
  parseSingleTableSelect,
} from "@lib/sql/queryAnalyzer";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import CellDetailDialog from "@components/datagrid/CellDetailDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { ExportButton } from "@components/shared/ExportButton";
import type { ExportContext, ExportFormat } from "@/lib/tauri";
import { getDataSourceProfile } from "@/types/dataSource";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import ScalarOrListPanel from "./ScalarOrListPanel";
import WriteSummaryPanel from "./WriteSummaryPanel";

interface QueryResultGridProps {
  queryState: QueryState;
  /** Connection used to look up PK metadata and run edit statements. */
  connectionId?: string;
  /** Database (schemaStore cache key dimension) — required when
   *  `connectionId` is supplied for editable-result lookups. */
  database?: string;
  /** SQL of the executed query — used to detect a single-table SELECT. */
  sql?: string;
  /** Called after a raw-result edit is committed so the parent can refresh. */
  onAfterCommit?: () => void;
  /**
   * Sprint 248 (ADR 0022 Phase 4) — when true, mounts a "Dry Run —
   * rolled back. No data was changed." banner above the result body so
   * users immediately understand the rows / counts they see were rolled
   * back. Derived from `queryState.completed.isDryRun` upstream so the
   * grid stays paradigm-agnostic.
   */
  isDryRun?: boolean;
}

/** Human-readable label for a QueryType value. */
function queryTypeLabel(qt: QueryType): string {
  if (qt === "select") return "SELECT";
  if (qt === "ddl") return "DDL";
  if (typeof qt === "object" && "dml" in qt) return "DML";
  return "Query";
}

/** Format a cell value for display. Sprint 238: compact JSON 1-line.
 * Sprint 261 (ADR 0026) — Decimal is `typeof === "object"` so it must
 * be detected before the generic object branch (which would emit a
 * quoted JSON string). BigInt is `typeof === "bigint"` and falls through
 * to `String(cell)` losslessly via BigInt.toString. */
function formatCell(cell: unknown): string {
  if (cell == null) return "NULL";
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object" && cell !== null) {
    return safeStringifyCell(cell);
  }
  return String(cell);
}

function ResultTable({ result }: { result: QueryResult }) {
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);

  // Sprint 258 — column widths via shared hook + `--cols` CSS variable.
  // Sprint 260 (AC-260-02) — drag-resize 도 활성, 단 read-only query
  // 결과는 stable identity 가 없어 (다음 query 마다 columns 가 바뀜)
  // persistenceKey 없이 in-memory only. cmd+shift+r reset 도 미연결.
  const widthColumns = useMemo(
    () => result.columns.map((c) => ({ name: c.name, category: c.category })),
    [result.columns],
  );
  const { widths, setWidth } = useColumnWidths(widthColumns);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const visualWidthsPx = useMemo(() => {
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return result.columns.map((col) => {
      const stored = widths[col.name];
      if (stored != null) return stored;
      return getDefaultRem(col.category) * rootFontSizePx;
    });
  }, [result.columns, widths]);

  const colsTemplate = useMemo(
    () => visualWidthsPx.map((w) => `${w}px`).join(" "),
    [visualWidthsPx],
  );

  const visualWidthsRef = useRef(visualWidthsPx);
  visualWidthsRef.current = visualWidthsPx;
  const getCurrentWidths = useCallback(() => visualWidthsRef.current, []);

  const { handleResizeStart } = useColumnResize({
    outerRef: scrollContainerRef,
    getCurrentWidths,
    onCommitWidth: setWidth,
  });

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto text-sm"
      role="grid"
      aria-rowcount={1 + result.rows.length}
      aria-colcount={result.columns.length}
      style={{ "--cols": colsTemplate } as CSSProperties}
    >
      <div
        role="rowgroup"
        className="sticky top-0 z-10 bg-secondary"
        style={{ minWidth: "max-content" }}
      >
        <div
          role="row"
          aria-rowindex={1}
          style={{
            display: "grid",
            gridTemplateColumns: "var(--cols)",
            // Sprint 261 — bg-secondary 가 horizontal scroll 끝까지 그려지도록.
            minWidth: "max-content",
          }}
        >
          {result.columns.map((col, visualIdx) => (
            <div
              key={col.name}
              role="columnheader"
              aria-colindex={visualIdx + 1}
              className="relative flex flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
            >
              <div className="truncate">{col.name}</div>
              <div className="mt-0.5 truncate text-3xs text-muted-foreground">
                {col.dataType}
              </div>
              <div
                className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60"
                onMouseDown={(e) => handleResizeStart(e, col.name, visualIdx)}
              />
            </div>
          ))}
        </div>
      </div>
      <div role="rowgroup">
        {result.rows.map((row, rowIdx) => (
          <div
            key={`row-${rowIdx}`}
            role="row"
            aria-rowindex={rowIdx + 2}
            className="border-b border-border hover:bg-muted"
            style={{
              display: "grid",
              gridTemplateColumns: "var(--cols)",
              minWidth: "max-content",
            }}
          >
            {row.map((cell, cellIdx) => {
              const col = result.columns[cellIdx];
              return (
                <div
                  key={cellIdx}
                  role="gridcell"
                  aria-colindex={cellIdx + 1}
                  className="flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground cursor-pointer"
                  title={`${formatCell(cell)}\n\n(double-click to expand)`}
                  onDoubleClick={() => {
                    if (col) {
                      setCellDetail({
                        data: cell,
                        columnName: col.name,
                        dataType: col.dataType,
                      });
                    }
                  }}
                >
                  {cell == null ? (
                    <span className="italic text-muted-foreground">NULL</span>
                  ) : (
                    <span
                      dir="auto"
                      className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                    >
                      {formatCell(cell)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {result.rows.length === 0 && (
          <div
            role="row"
            className="border-b border-border"
            style={{ minWidth: "max-content" }}
          >
            <div
              role="gridcell"
              aria-colindex={1}
              style={{ gridColumn: "1 / -1" }}
              className="px-3 py-4 text-center text-xs text-muted-foreground"
            >
              No data
            </div>
          </div>
        )}
      </div>
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
  const qt = result.queryType;
  const rowsAffected =
    typeof qt === "object" && "dml" in qt
      ? qt.dml.rows_affected
      : result.totalCount;
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
  database,
  sql,
  onAfterCommit,
}: {
  result: QueryResult;
  connectionId?: string;
  database?: string;
  sql?: string;
  onAfterCommit?: () => void;
}) {
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const connection = useConnectionStore((s) =>
    connectionId
      ? s.connections.find((candidate) => candidate.id === connectionId)
      : undefined,
  );
  const defaultSchema = connection?.dbType === "sqlite" ? "main" : "public";

  // Identify the source table once per SQL so we can fetch + look up its
  // primary-key metadata. Resolution falls back to "public" because that's
  // the default schema in PostgreSQL.
  const parsed = useMemo(() => {
    if (!sql) return null;
    const info = parseSingleTableSelect(sql);
    if (!info) return null;
    return { schema: info.schema ?? defaultSchema, table: info.table };
  }, [defaultSchema, sql]);

  useEffect(() => {
    if (!parsed || !connectionId || !database) return;
    const cached =
      tableColumnsCache[connectionId]?.[database]?.[parsed.schema]?.[
        parsed.table
      ];
    if (!cached) {
      getTableColumns(
        connectionId,
        database,
        parsed.table,
        parsed.schema,
      ).catch(() => {
        // If the lookup fails we leave the cache empty; the editability
        // analyser surfaces this as "Loading column metadata…".
      });
    }
  }, [parsed, connectionId, database, tableColumnsCache, getTableColumns]);

  const tableColumns = useMemo(() => {
    if (!parsed || !connectionId || !database) return null;
    return (
      tableColumnsCache[connectionId]?.[database]?.[parsed.schema]?.[
        parsed.table
      ] ?? null
    );
  }, [parsed, connectionId, database, tableColumnsCache]);

  const editability = useMemo(
    () =>
      sql
        ? analyzeResultEditability(
            sql,
            result.columns,
            tableColumns,
            defaultSchema,
          )
        : null,
    [sql, result.columns, tableColumns, defaultSchema],
  );
  const rowEditBlockReason = useMemo(() => {
    if (!connection) return null;
    const profile = getDataSourceProfile(connection.dbType);
    if (!profile.capabilities.edit.editRows) {
      return `${profile.id} row editing is not supported.`;
    }
    if (connection.dbType === "sqlite" && connection.readOnly) {
      return "read-only SQLite connection";
    }
    return null;
  }, [connection]);

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

  if (editability && editability.editable && rowEditBlockReason === null) {
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
            <span>
              Read-only —{" "}
              {editability.editable ? rowEditBlockReason : editability.reason}
            </span>
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
  database,
  sql,
  onAfterCommit,
}: {
  result: QueryResult;
  connectionId?: string;
  database?: string;
  sql?: string;
  onAfterCommit?: () => void;
}) {
  // Sprint 312 (Phase 28 Slice A6, 2026-05-14) — `resultKind` discriminator
  // router. Mongo paradigms set `"scalar"` / `"list"` / `"writeSummary"`;
  // RDB + Mongo find / aggregate / findOne(matched) leave it undefined or
  // `"grid"` and hit the legacy DataGrid path. The dispatch happens at the
  // top of the function so the status-bar + DataGrid scaffolding stays
  // unchanged for the grid path (zero RDB regression risk).
  if (result.resultKind === "writeSummary" && result.writeSummary) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-secondary-foreground">
          <span>Write</span>
          <span className="text-muted-foreground">
            {result.executionTimeMs} ms
          </span>
        </div>
        <WriteSummaryPanel summary={result.writeSummary} />
      </div>
    );
  }
  if (result.resultKind === "scalar" || result.resultKind === "list") {
    // count   → 1-row 1-col `count` column
    // distinct → 1-col `value` (or whatever name was projected)
    // findOne(null) → empty columns + empty rows (D-12)
    const mode: "count" | "list" | "findOne-empty" =
      result.resultKind === "list"
        ? "list"
        : result.columns[0]?.name === "count"
          ? "count"
          : "findOne-empty";
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-secondary-foreground">
          <span>
            {mode === "count" ? "Count" : mode === "list" ? "List" : "findOne"}
            {mode === "list" && (
              <>
                {" "}
                &mdash; {result.totalCount.toLocaleString()} value
                {result.totalCount !== 1 ? "s" : ""}
              </>
            )}
          </span>
          <span className="text-muted-foreground">
            {result.executionTimeMs} ms
          </span>
        </div>
        <ScalarOrListPanel result={result} mode={mode} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-secondary-foreground">
        <span>
          {queryTypeLabel(result.queryType)}
          {result.queryType === "select" && (
            <>
              {" "}
              &mdash; {result.totalCount.toLocaleString()} row
              {result.totalCount !== 1 ? "s" : ""}
            </>
          )}
        </span>
        <span className="text-muted-foreground">
          {result.executionTimeMs} ms
        </span>
      </div>

      {/* Content */}
      {result.queryType === "select" && (
        <SelectResultArea
          result={result}
          connectionId={connectionId}
          database={database}
          sql={sql}
          onAfterCommit={onAfterCommit}
        />
      )}
      {typeof result.queryType === "object" && "dml" in result.queryType && (
        <DmlMessage result={result} />
      )}
      {result.queryType === "ddl" && <DdlMessage />}
    </div>
  );
}

/** Verb label shown in each multi-statement tab trigger. */
function statementVerb(stmt: QueryStatementResult): string {
  if (stmt.status === "error") return "ERROR";
  if (stmt.result) return queryTypeLabel(stmt.result.queryType);
  return "Query";
}

/**
 * Trigger badge: "{rows} rows" / "{ms} ms" for success, "✕" for error.
 * SELECT shows row count; DML/DDL show wall-clock duration.
 */
function statementBadge(stmt: QueryStatementResult): string {
  if (stmt.status === "error") return "✕";
  if (!stmt.result) return `${stmt.durationMs} ms`;
  if (stmt.result.queryType === "select") {
    const n = stmt.result.totalCount;
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
  database,
  onAfterCommit,
}: {
  statements: QueryStatementResult[];
  connectionId?: string;
  database?: string;
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
              database={database}
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
  database,
  sql,
  onAfterCommit,
  isDryRun: isDryRunProp,
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
    // Sprint 248 — explicit `isDryRun` prop wins over the queryState
    // flag (so callers wrapping the grid in a custom shell can force
    // the banner), but defaults to the queryState payload so QueryTab
    // doesn't need a derive step.
    const isDryRun = isDryRunProp ?? queryState.isDryRun === true;

    // Multi-statement runs render one tab per statement; single-statement
    // (or callers that omit `statements`) keep the bare single-result UI
    // — no Tabs scaffolding, so `queryByRole("tab") === null` holds.
    const body =
      queryState.statements && queryState.statements.length >= 2 ? (
        <CompletedMultiResult
          statements={queryState.statements}
          connectionId={connectionId}
          database={database}
          onAfterCommit={onAfterCommit}
        />
      ) : (
        <CompletedSingleResult
          result={queryState.result}
          connectionId={connectionId}
          database={database}
          sql={sql}
          onAfterCommit={onAfterCommit}
        />
      );

    if (isDryRun) {
      return (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Sprint 248 (ADR 0022 Phase 4) — dry-run rolled-back banner.
              Mounted above both single + multi result bodies so the
              user can see at a glance that nothing was committed. */}
          <div
            role="status"
            data-testid="dry-run-banner"
            className="border-b border-warning/40 bg-warning/10 px-3 py-1 text-xs text-warning"
          >
            Dry Run — rolled back. No data was changed.
          </div>
          {body}
        </div>
      );
    }
    return body;
  }

  // Idle state — prompt the user
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">Press Cmd+Return to execute the query</p>
    </div>
  );
}
