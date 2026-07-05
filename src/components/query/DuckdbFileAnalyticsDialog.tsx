import { useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, Loader2, Play } from "lucide-react";

import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { DialogShell } from "@components/ui/dialog-shell";
import {
  executeFileAnalyticsQuery,
  previewFileAnalyticsSource,
  registerFileAnalyticsSource,
} from "@lib/tauri/fileAnalytics";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import { sqlIdentifier } from "@lib/sql/sqlLiteral";
import { useSchemaStore } from "@stores/schemaStore";
import type {
  FileAnalyticsPreview,
  FileAnalyticsQueryResponse,
  FileAnalyticsSource,
} from "@/types/fileAnalytics";

interface DuckdbFileAnalyticsDialogProps {
  connectionId: string;
  database?: string;
  tabId?: string;
  onClose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fileNameFromPath(path: string): string | null {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visibleFileAnalyticsError(
  error: unknown,
  replacement: string | null,
  exactPath?: string,
): string {
  const safeReplacement = replacement ?? "<local-file>";
  let message = errorMessage(error);
  if (exactPath) {
    message = message.replace(
      new RegExp(escapeRegExp(exactPath), "g"),
      safeReplacement,
    );
  }
  return message.replace(
    /(?:[A-Za-z]:\\|\/(?:Users|home|private|tmp|var|Volumes)\/)[^\s"'<>)]*/g,
    safeReplacement,
  );
}

function pickedPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function defaultSourceSql(source: FileAnalyticsSource): string {
  // DuckDB uses ANSI double-quote identifiers; the canonical quoter's
  // postgres + quotePostgres path emits exactly that (#1357).
  // ponytail: no "duckdb" dialect in SqlDialect — reuse the ANSI-quote path.
  const alias = sqlIdentifier(source.alias, "postgresql", {
    quotePostgres: true,
  });
  return `SELECT * FROM ${alias} LIMIT 100`;
}

type AnalyticsResult = FileAnalyticsPreview["result"];

function ResultTable({ result }: { result: AnalyticsResult }) {
  return (
    <div className="overflow-auto rounded border border-border bg-background">
      <table className="w-full min-w-max border-collapse text-xs">
        <thead className="bg-secondary text-muted-foreground">
          <tr>
            {result.columns.map((column) => (
              <th
                key={column.name}
                className="border-b border-border px-3 py-2 text-left font-medium"
              >
                {column.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border/60">
              {result.columns.map((column, columnIndex) => (
                <td
                  key={`${rowIndex}-${column.name}`}
                  className="max-w-64 truncate px-3 py-2"
                  title={String(row[columnIndex] ?? "")}
                >
                  {String(row[columnIndex] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DuckdbFileAnalyticsDialog({
  connectionId,
  database,
  tabId,
  onClose,
}: DuckdbFileAnalyticsDialogProps) {
  const { t } = useTranslation("query");
  const [source, setSource] = useState<FileAnalyticsSource | null>(null);
  const [preview, setPreview] = useState<FileAnalyticsPreview | null>(null);
  const [querySql, setQuerySql] = useState("");
  const [queryResult, setQueryResult] =
    useState<FileAnalyticsQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadFileAnalyticsSources = useSchemaStore(
    (s) => s.loadFileAnalyticsSources,
  );

  const chooseFile = async () => {
    setLoading(true);
    setError(null);
    let selectedPath: string | null = null;
    try {
      selectedPath = pickedPath(
        await open({
          multiple: false,
          directory: false,
          filters: [
            {
              name: "DuckDB analytics",
              extensions: ["csv", "parquet", "json", "ndjson"],
            },
          ],
        }),
      );
      if (!selectedPath) return;

      setSource(null);
      setPreview(null);
      setQueryResult(null);
      setQuerySql("");
      const registered = await registerFileAnalyticsSource(
        connectionId,
        selectedPath,
      );
      const nextPreview = await previewFileAnalyticsSource(
        connectionId,
        registered.id,
        100,
      );
      setSource(registered);
      setPreview(nextPreview);
      setQuerySql(defaultSourceSql(registered));
      void loadFileAnalyticsSources(connectionId).catch(() => undefined);
    } catch (err) {
      setError(
        visibleFileAnalyticsError(
          err,
          selectedPath ? fileNameFromPath(selectedPath) : null,
          selectedPath ?? undefined,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const runSourceQuery = async () => {
    if (!source) return;

    setQueryLoading(true);
    setError(null);
    setQueryResult(null);
    const startedAt = Date.now();
    try {
      const nextResult = await executeFileAnalyticsQuery(
        connectionId,
        source.id,
        querySql,
      );
      setQueryResult(nextResult);
      recordHistoryEntry({
        connectionId,
        database,
        collection: source.fileName,
        tabId,
        source: "file-analytics",
        sql: querySql,
        status: "success",
        executedAt: startedAt,
        duration: Math.max(0, Date.now() - startedAt),
        rowsAffected: nextResult.result.rows.length,
        paradigm: "rdb",
        queryMode: "sql",
      });
    } catch (err) {
      setError(visibleFileAnalyticsError(err, source.fileName));
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogShell className="max-w-3xl">
        <DialogShell.Header>
          <DialogHeader className="px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileSearch className="size-4 shrink-0" />
              <DialogTitle className="truncate text-sm">
                {t("fileAnalytics.dialogTitle")}
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              {t("fileAnalytics.dialogDescriptionSrOnly")}
            </DialogDescription>
          </DialogHeader>
        </DialogShell.Header>

        <DialogShell.Body className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={chooseFile}
              disabled={loading}
              aria-label={t("fileAnalytics.chooseFileAria")}
            >
              {loading ? <Loader2 className="animate-spin" /> : <FileSearch />}
              <span>{t("fileAnalytics.chooseFile")}</span>
            </Button>
            {source && (
              <div className="min-w-0 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {source.fileName}
                </span>
                <span className="ml-2 uppercase">{source.kind}</span>
                <span className="ml-2">{source.sizeBytes} bytes</span>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          {preview && (
            <div
              role="region"
              aria-label={t("fileAnalytics.previewResultAria")}
              className="space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t("fileAnalytics.previewResult")}
              </div>
              <ResultTable result={preview.result} />
            </div>
          )}

          {source && (
            <div className="space-y-2">
              <label
                htmlFor="duckdb-file-analytics-source-sql"
                className="text-xs font-medium text-muted-foreground"
              >
                {t("fileAnalytics.sourceSQL")}
              </label>
              <textarea
                id="duckdb-file-analytics-source-sql"
                value={querySql}
                onChange={(event) => setQuerySql(event.target.value)}
                className="min-h-20 w-full resize-y rounded border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                spellCheck={false}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={runSourceQuery}
                  disabled={queryLoading || querySql.trim().length === 0}
                  aria-label={t("fileAnalytics.runSourceQueryAria")}
                >
                  {queryLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  <span>{t("fileAnalytics.runQuery")}</span>
                </Button>
              </div>
            </div>
          )}

          {queryResult && (
            <div
              role="region"
              aria-label={t("fileAnalytics.queryResultAria")}
              className="space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t("fileAnalytics.queryResult")}
              </div>
              <ResultTable result={queryResult.result} />
            </div>
          )}
        </DialogShell.Body>

        <DialogShell.Footer>
          <DialogFooter className="px-4 py-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              {t("fileAnalytics.close")}
            </Button>
          </DialogFooter>
        </DialogShell.Footer>
      </DialogShell>
    </Dialog>
  );
}
