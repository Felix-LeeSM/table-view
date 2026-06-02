import { useState } from "react";
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
import type {
  FileAnalyticsPreview,
  FileAnalyticsQueryResponse,
  FileAnalyticsSource,
} from "@/types/fileAnalytics";

interface DuckdbFileAnalyticsDialogProps {
  connectionId: string;
  onClose: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pickedPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function defaultSourceSql(source: FileAnalyticsSource): string {
  return `SELECT * FROM ${quoteIdentifier(source.alias)} LIMIT 100`;
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
  onClose,
}: DuckdbFileAnalyticsDialogProps) {
  const [source, setSource] = useState<FileAnalyticsSource | null>(null);
  const [preview, setPreview] = useState<FileAnalyticsPreview | null>(null);
  const [querySql, setQuerySql] = useState("");
  const [queryResult, setQueryResult] =
    useState<FileAnalyticsQueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseFile = async () => {
    setLoading(true);
    setError(null);
    try {
      const selected = pickedPath(
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
      if (!selected) return;

      setSource(null);
      setPreview(null);
      setQueryResult(null);
      setQuerySql("");
      const registered = await registerFileAnalyticsSource(
        connectionId,
        selected,
      );
      const nextPreview = await previewFileAnalyticsSource(
        connectionId,
        registered.id,
        100,
      );
      setSource(registered);
      setPreview(nextPreview);
      setQuerySql(defaultSourceSql(registered));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const runSourceQuery = async () => {
    if (!source) return;

    setQueryLoading(true);
    setError(null);
    setQueryResult(null);
    try {
      const nextResult = await executeFileAnalyticsQuery(
        connectionId,
        source.id,
        querySql,
      );
      setQueryResult(nextResult);
    } catch (err) {
      setError(errorMessage(err));
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
                Local file query
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">
              Query a registered DuckDB local file source.
            </DialogDescription>
          </DialogHeader>
        </DialogShell.Header>

        <DialogShell.Body className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={chooseFile}
              disabled={loading}
              aria-label="Choose local file"
            >
              {loading ? <Loader2 className="animate-spin" /> : <FileSearch />}
              <span>Choose File</span>
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
              aria-label="Preview result"
              className="space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                Preview result
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
                Source SQL
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
                  aria-label="Run source query"
                >
                  {queryLoading ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Play />
                  )}
                  <span>Run Query</span>
                </Button>
              </div>
            </div>
          )}

          {queryResult && (
            <div role="region" aria-label="Query result" className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Query result
              </div>
              <ResultTable result={queryResult.result} />
            </div>
          )}
        </DialogShell.Body>

        <DialogShell.Footer>
          <DialogFooter className="px-4 py-3">
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogShell.Footer>
      </DialogShell>
    </Dialog>
  );
}
