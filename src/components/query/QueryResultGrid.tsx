import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Info, Loader2, Pencil } from "lucide-react";
import type {
  QueryResult,
  QueryState,
  QueryStatementResult,
  QueryType,
} from "@/types/query";
import {
  analyzeResultEditability,
  parseSingleTableSelect,
  resolveDefaultSchema,
} from "@lib/sql/queryAnalyzer";
import { useSchemaStore } from "@stores/schemaStore";
import { useConnectionStore } from "@stores/connectionStore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { CopyTextButton } from "@components/shared/CopyTextButton";
import { ExportButton } from "@components/shared/ExportButton";
import { getDataSourceProfile } from "@/types/dataSource";
import { SearchResultView } from "@components/search/SearchResultView";
import { DriverErrorHint } from "@components/errors/DriverErrorHint";
import { classifyDriverError } from "@lib/errors/driverErrorHints";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import { QueryResultTable } from "./QueryResultTable";
import ScalarOrListPanel from "./ScalarOrListPanel";
import WriteSummaryPanel from "./WriteSummaryPanel";
import { resolveQueryExportBoundary } from "./queryExportBoundary";

const NON_GRID_SQL_EXPORT_REASON =
  "SQL INSERT export requires a single-table SQL result.";

export interface QueryResultGridProps {
  queryState: QueryState;
  /** Connection used to look up PK metadata and run edit statements. */
  connectionId?: string;
  /** Database (schemaStore cache key dimension) — required when
   *  `connectionId` is supplied for editable-result lookups. */
  database?: string;
  /** Live editor SQL — back-compat fallback ONLY. Edit-ability is judged
   *  against the executed snapshot on `queryState.completed.sql` (single) or
   *  each `stmt.sql` (multi); this prop is used only when that snapshot is
   *  absent. Issue #1226. */
  sql?: string;
  /** Owning query tab id — Issue #1102, scopes the editable-result pending
   *  store and drives `setTabDirty`. */
  tabId?: string;
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

function resultUnitNoun(result: QueryResult): string {
  const singular = result.resultUnit === "document" ? "document" : "row";
  return result.totalCount === 1 ? singular : `${singular}s`;
}

function formatCopyValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function formatCopyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatNonGridCopyText(
  result: QueryResult,
  mode: "count" | "list" | "findOne-empty",
): string {
  if (mode === "findOne-empty" || result.rows.length === 0) return "";
  if (mode === "count") return formatCopyValue(result.rows[0]?.[0]);
  return result.rows.map((row) => formatCopyValue(row[0])).join("\n");
}

function DmlMessage({ result }: { result: QueryResult }) {
  const { t } = useTranslation("query");
  const qt = result.queryType;
  const rowsAffected =
    typeof qt === "object" && "dml" in qt
      ? qt.dml.rows_affected
      : result.totalCount;
  return (
    <div className="flex items-center justify-center py-8 text-sm text-secondary-foreground">
      {t("resultGrid.rowsAffected", {
        count: rowsAffected.toLocaleString(),
        plural: rowsAffected !== 1 ? "s" : "",
      })}
    </div>
  );
}

function DdlMessage() {
  const { t } = useTranslation("query");
  return (
    <div className="flex items-center justify-center py-8 text-sm text-secondary-foreground">
      {t("resultGrid.queryExecutedSuccessfully")}
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
  tabId,
  onAfterCommit,
}: {
  result: QueryResult;
  connectionId?: string;
  database?: string;
  sql?: string;
  tabId?: string;
  onAfterCommit?: () => void;
}) {
  const { t } = useTranslation("query");
  const tableColumnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);
  const fileAnalyticsSources = useSchemaStore((s) =>
    connectionId ? s.fileAnalyticsSources[connectionId] : undefined,
  );
  const connection = useConnectionStore((s) =>
    connectionId
      ? s.connections.find((candidate) => candidate.id === connectionId)
      : undefined,
  );
  const defaultSchema = resolveDefaultSchema(
    connection?.dbType,
    database ?? "",
    connection?.user ?? "",
  );
  const isDocumentResult = result.resultUnit === "document";
  // Identify the source table once per SQL so we can fetch + look up its
  // primary-key metadata. An unqualified table resolves to the DBMS default
  // schema (resolveDefaultSchema) so PK lookup matches the cached columns —
  // "public" is only correct for PostgreSQL (issue #1066).
  const parsed = useMemo(() => {
    if (isDocumentResult) return null;
    if (!sql) return null;
    const info = parseSingleTableSelect(sql);
    if (!info) return null;
    return { schema: info.schema ?? defaultSchema, table: info.table };
  }, [defaultSchema, isDocumentResult, sql]);
  const exportBoundary = useMemo(
    () =>
      resolveQueryExportBoundary(
        connection?.dbType,
        parsed,
        fileAnalyticsSources,
      ),
    [connection?.dbType, parsed, fileAnalyticsSources],
  );

  useEffect(() => {
    if (
      !parsed ||
      exportBoundary.registeredFileAlias ||
      !connectionId ||
      !database
    )
      return;
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
  }, [
    parsed,
    exportBoundary.registeredFileAlias,
    connectionId,
    database,
    tableColumnsCache,
    getTableColumns,
  ]);

  const tableColumns = useMemo(() => {
    if (
      !parsed ||
      exportBoundary.registeredFileAlias ||
      !connectionId ||
      !database
    )
      return null;
    return (
      tableColumnsCache[connectionId]?.[database]?.[parsed.schema]?.[
        parsed.table
      ] ?? null
    );
  }, [
    parsed,
    exportBoundary.registeredFileAlias,
    connectionId,
    database,
    tableColumnsCache,
  ]);

  const editability = useMemo(
    () =>
      isDocumentResult
        ? null
        : exportBoundary.readOnlyReason
          ? {
              editable: false as const,
              reason: exportBoundary.readOnlyReason,
            }
          : sql
            ? analyzeResultEditability(
                sql,
                result.columns,
                tableColumns,
                defaultSchema,
              )
            : null,
    [
      isDocumentResult,
      exportBoundary.readOnlyReason,
      sql,
      result.columns,
      tableColumns,
      defaultSchema,
    ],
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

  const exportButton = (
    <ExportButton
      context={exportBoundary.context}
      headers={result.columns.map((c) => c.name)}
      getRows={() => result.rows as unknown[][]}
      disabledFormats={exportBoundary.disabledFormats}
      disabledFormatReasons={exportBoundary.disabledReasons}
    />
  );

  if (editability && editability.editable && rowEditBlockReason === null) {
    return (
      <>
        <div className="flex items-center justify-between gap-2 border-b border-border bg-success/10 px-3 py-0.5 text-xs text-success">
          <span className="flex items-center gap-1.5">
            <Pencil size={12} />
            <span>{t("resultGrid.editableBanner")}</span>
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
          tabId={tabId}
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
              {t("resultGrid.readonlyBanner")}{" "}
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
      <QueryResultTable result={result} />
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
  tabId,
  onAfterCommit,
}: {
  result: QueryResult;
  connectionId?: string;
  database?: string;
  sql?: string;
  tabId?: string;
  onAfterCommit?: () => void;
}) {
  // Sprint 312 (Phase 28 Slice A6, 2026-05-14) — `resultKind` discriminator
  // router. Mongo paradigms set `"scalar"` / `"list"` / `"writeSummary"`;
  // RDB + Mongo find / aggregate / findOne(matched) leave it undefined or
  // `"grid"` and hit the legacy DataGrid path. The dispatch happens at the
  // top of the function so the status-bar + DataGrid scaffolding stays
  // unchanged for the grid path (zero RDB regression risk).
  if (result.resultKind === "writeSummary" && result.writeSummary) {
    const summaryText = formatCopyJson(result.writeSummary);
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs text-secondary-foreground">
          <span>Write</span>
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">
              {result.executionTimeMs} ms
            </span>
            <CopyTextButton
              text={summaryText}
              ariaLabel="Copy write summary"
              disabledReason="No write summary to copy."
            />
            <ExportButton
              context={{ kind: "query", source_table: null }}
              headers={[]}
              getRows={() => []}
              disabled
              disabledReason="Write summaries are not exportable as grid rows."
            />
          </div>
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
    const canExportValues = mode !== "findOne-empty" && result.rows.length > 0;
    const copyText = formatNonGridCopyText(result, mode);
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
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">
              {result.executionTimeMs} ms
            </span>
            <CopyTextButton
              text={copyText}
              ariaLabel="Copy result values"
              disabledReason="No result values to copy."
            />
            <ExportButton
              context={{ kind: "query", source_table: null }}
              headers={result.columns.map((column) => column.name)}
              getRows={() => result.rows as unknown[][]}
              disabled={!canExportValues}
              disabledReason="No result values to export."
              disabledFormats={["sql"]}
              disabledFormatReasons={{
                sql: NON_GRID_SQL_EXPORT_REASON,
              }}
            />
          </div>
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
              &mdash; {result.totalCount.toLocaleString()}{" "}
              {resultUnitNoun(result)}
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
          tabId={tabId}
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
  tabId,
  onAfterCommit,
}: {
  statements: QueryStatementResult[];
  connectionId?: string;
  database?: string;
  tabId?: string;
  onAfterCommit?: () => void;
}) {
  const { t } = useTranslation("query");
  return (
    <Tabs
      defaultValue="stmt-0"
      activationMode="automatic"
      className="flex flex-1 flex-col overflow-hidden"
    >
      <TabsList
        className="shrink-0 gap-0 border-b border-border bg-secondary px-1"
        aria-label={t("resultGrid.statementResultsAria")}
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
                  {t("resultGrid.statementTab", {
                    n: idx + 1,
                    verb: statementVerb(stmt),
                  })}
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
              <div className="font-medium">
                {t("resultGrid.statementFailed", { n: idx + 1 })}
              </div>
              <DriverErrorHint
                hint={classifyDriverError(stmt.error ?? "")}
                showTitle={false}
                className="mt-1"
              />
              <div className="mt-1 whitespace-pre-wrap text-xs opacity-80">
                {stmt.error ?? t("resultGrid.unknownError")}
              </div>
            </div>
          ) : (
            <CompletedSingleResult
              result={stmt.result}
              connectionId={connectionId}
              database={database}
              sql={stmt.sql}
              tabId={tabId}
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
  tabId,
  onAfterCommit,
  isDryRun: isDryRunProp,
}: QueryResultGridProps) {
  const { t } = useTranslation("query");
  // Running state
  if (queryState.status === "running") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <Loader2
          className="mb-2 animate-spin text-muted-foreground"
          size={24}
        />
        <p className="text-sm text-muted-foreground">
          {t("resultGrid.executing")}
        </p>
      </div>
    );
  }

  // Error state
  if (queryState.status === "error") {
    const hint = classifyDriverError(queryState.error);
    return (
      <div className="flex flex-1 flex-col">
        <div
          role="alert"
          className="border-b border-border bg-muted px-3 py-2 text-sm text-destructive"
        >
          <DriverErrorHint hint={hint} className="mb-1" />
          <div className={hint ? "text-xs opacity-80" : undefined}>
            {queryState.error}
          </div>
        </div>
      </div>
    );
  }

  if (queryState.status === "cancelled") {
    return (
      <div
        role="status"
        data-testid="query-cancelled-state"
        className="flex flex-1 flex-col items-center justify-center text-sm text-muted-foreground"
      >
        <p>{queryState.message ?? t("resultGrid.cancelled")}</p>
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
          tabId={tabId}
          onAfterCommit={onAfterCommit}
        />
      ) : (
        <CompletedSingleResult
          result={queryState.result}
          connectionId={connectionId}
          database={database}
          // #1226 — judge edit-ability against the executed snapshot stored on
          // the completed state; the `sql` prop (live editor text) is only a
          // back-compat fallback for callers that don't populate the snapshot.
          sql={queryState.sql ?? sql}
          tabId={tabId}
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
            {t("resultGrid.dryRunBanner")}
          </div>
          {body}
        </div>
      );
    }
    return body;
  }

  if (queryState.status === "completedSearch") {
    return <SearchResultView result={queryState.result} />;
  }

  // Idle state — prompt the user
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
      <p className="text-sm">{t("resultGrid.idlePrompt")}</p>
    </div>
  );
}
