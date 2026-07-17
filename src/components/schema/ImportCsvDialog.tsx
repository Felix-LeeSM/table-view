import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSpreadsheet, Loader2 } from "lucide-react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  buildCsvImportStatements,
  previewCsvImport,
  type CsvPreview,
} from "@lib/tauri/import";
import { cancelQuery, executeQueryBatch } from "@lib/tauri";
import { useSchemaStore } from "@stores/schemaStore";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";
import type { ColumnInfo } from "@/types/schema";

/**
 * `ImportCsvDialog` — issue #1639 preview + #1640 commit. A CSV import wizard:
 * pick a file, preview its parsed headers + sample rows (streamed backend
 * command `preview_csv_import`), map target-table columns to CSV headers, then
 * commit. The commit builds one single-row INSERT per row
 * (`build_csv_import_statements`) and runs the whole list through the existing
 * `executeQueryBatch` command in one atomic transaction (all-or-nothing
 * rollback, reusing Safe Mode / read-only gates + history + cancel). The engine
 * gate lives in `csvImportSupport.ts` (PG-first).
 */
interface ImportCsvDialogProps {
  connectionId: string;
  database: string;
  schemaName: string;
  tableName: string;
  onClose: () => void;
}

// Non-empty sentinel for an unmapped column — Radix `Select` items may not use
// an empty-string value (mirrors SchemaErdPanel's `NO_COMPARISON`).
export const SKIP = "__skip__";

function pickedPath(value: string | string[] | null): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/**
 * Auto-map each table column to the CSV header with a case-insensitive name
 * match, else leave it unmapped (skip). Pure so it stays unit-testable.
 */
export function autoMapColumns(
  columns: readonly ColumnInfo[],
  headers: readonly string[],
): Record<string, string> {
  const byLower = new Map(headers.map((h) => [h.toLowerCase(), h]));
  const mapping: Record<string, string> = {};
  for (const col of columns) {
    mapping[col.name] = byLower.get(col.name.toLowerCase()) ?? SKIP;
  }
  return mapping;
}

export default function ImportCsvDialog({
  connectionId,
  database,
  schemaName,
  tableName,
  onClose,
}: ImportCsvDialogProps) {
  const { t } = useTranslation("csvImport");
  const getTableColumns = useSchemaStore((s) => s.getTableColumns);

  const [columns, setColumns] = useState<ColumnInfo[]>([]);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [emptyAsNull, setEmptyAsNull] = useState(true);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Commit lifecycle. `confirming` shows the pre-write confirmation summary;
  // `committing` holds the in-flight import's cancel-token id + row total;
  // `imported` is the success count. Only one is non-null at a time.
  const [confirming, setConfirming] = useState(false);
  const [committing, setCommitting] = useState<{
    queryId: string;
    total: number;
  } | null>(null);
  const [imported, setImported] = useState<number | null>(null);

  // Load the target table's columns once — the mapping wizard renders one row
  // per column. schemaStore is cache-first, so this is a no-op after warm-up.
  useEffect(() => {
    let cancelled = false;
    void getTableColumns(
      connectionId,
      database as DatabaseName,
      schemaName as SchemaName,
      tableName as TableName,
    )
      .then((cols) => {
        if (!cancelled) setColumns(cols);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [getTableColumns, connectionId, database, schemaName, tableName]);

  const runPreview = async (path: string, header: boolean) => {
    setLoading(true);
    setError(null);
    setImported(null);
    try {
      const next = await previewCsvImport(path, { hasHeader: header });
      setPreview(next);
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // Auto-map columns to CSV headers reactively. Deriving the mapping here (not
  // inside `runPreview`) fixes a stale-capture race: `runPreview` captured
  // `columns`, so a preview that resolved before the async column load left the
  // mapping empty and never recomputed. Keyed on both, it re-runs when the
  // target columns arrive AND resets to a fresh auto-map on each new preview
  // (new file / header toggle). `columns` is loaded once and then stable, so a
  // user's manual mapping edits (which touch neither dep) are preserved.
  useEffect(() => {
    if (preview) setMapping(autoMapColumns(columns, preview.headers));
  }, [columns, preview]);

  const chooseFile = async () => {
    const path = pickedPath(
      await open({
        multiple: false,
        directory: false,
        filters: [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }],
      }),
    );
    if (!path) return;
    setFilePath(path);
    await runPreview(path, hasHeader);
  };

  const toggleHeader = async (next: boolean) => {
    setHasHeader(next);
    if (filePath) await runPreview(filePath, next);
  };

  const headers = useMemo(() => preview?.headers ?? [], [preview]);
  const previewRows = preview?.preview_rows ?? [];
  const rowCount = preview?.row_count ?? 0;

  // Target-column order, only mapped columns, resolved to a CSV record index.
  const mappedColumns = useMemo(
    () =>
      columns
        .map((col) => ({ column: col.name, header: mapping[col.name] }))
        .filter((m) => m.header !== undefined && m.header !== SKIP)
        .map((m) => ({
          column: m.column,
          sourceIndex: headers.indexOf(m.header as string),
        }))
        .filter((m) => m.sourceIndex >= 0),
    [columns, mapping, headers],
  );
  const mappedCount = mappedColumns.length;
  const canImport =
    !!filePath &&
    !!preview &&
    rowCount > 0 &&
    mappedCount > 0 &&
    !loading &&
    committing === null;

  const runImport = async () => {
    if (!filePath || !canImport) return;
    setConfirming(false);
    setError(null);
    setImported(null);
    const queryId = crypto.randomUUID();
    setCommitting({ queryId, total: rowCount });
    try {
      const statements = await buildCsvImportStatements(
        connectionId,
        filePath,
        schemaName,
        tableName,
        mappedColumns,
        { hasHeader, emptyAsNull },
      );
      if (statements.length === 0) {
        setImported(0);
        return;
      }
      // One atomic `executeQueryBatch` call — BEGIN/…/COMMIT with all-or-nothing
      // rollback. `safetyConfirmed: true` records the user's confirm; INSERT is
      // classified Info so the backend Safe Mode gate does not fire regardless,
      // while the #1529 read-only gate still hard-blocks a read-only connection.
      await executeQueryBatch(
        connectionId,
        statements,
        queryId,
        database,
        true,
      );
      setImported(statements.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCommitting(null);
    }
  };

  const cancelImport = async () => {
    if (committing) await cancelQuery(committing.queryId);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogShell className="max-w-3xl">
        <DialogShell.Header>
          <DialogHeader className="px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <FileSpreadsheet className="size-4 shrink-0" />
              <DialogTitle className="truncate text-sm">
                {t("title", { schema: schemaName, table: tableName })}
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              {t("readOnlyNotice")}
            </DialogDescription>
          </DialogHeader>
        </DialogShell.Header>

        <DialogShell.Body className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              onClick={chooseFile}
              disabled={loading}
              aria-label={t("chooseFileAria")}
            >
              {loading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileSpreadsheet />
              )}
              <span>{t("chooseFile")}</span>
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => void toggleHeader(e.target.checked)}
                aria-label={t("hasHeaderAria")}
                disabled={committing !== null}
              />
              {t("hasHeader")}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input
                type="checkbox"
                checked={emptyAsNull}
                onChange={(e) => setEmptyAsNull(e.target.checked)}
                aria-label={t("emptyAsNullAria")}
                disabled={committing !== null}
              />
              {t("emptyAsNull")}
            </label>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {t("rowCount", { count: preview.row_count })}
              </span>
            )}
          </div>

          {imported !== null && (
            <div
              role="status"
              className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"
            >
              {t("importSuccess", { count: imported })}
            </div>
          )}

          {confirming && (
            <div
              role="region"
              aria-label={t("confirmRegionAria")}
              className="space-y-1 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground"
            >
              <div className="font-medium">
                {t("confirmTitle", {
                  schema: schemaName,
                  table: tableName,
                  rows: rowCount,
                  columns: mappedCount,
                })}
              </div>
              <div className="text-muted-foreground">{t("confirmPolicy")}</div>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {error}
            </div>
          )}

          {preview && headers.length > 0 && (
            <div
              role="region"
              aria-label={t("mappingRegionAria")}
              className="space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t("mappingLabel", {
                  mapped: mappedCount,
                  total: columns.length,
                })}
              </div>
              <div className="grid gap-1.5">
                {columns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span
                      className="min-w-0 flex-1 truncate font-medium text-foreground"
                      title={`${col.name} (${col.data_type})`}
                    >
                      {col.name}
                    </span>
                    <Select
                      value={mapping[col.name] ?? SKIP}
                      onValueChange={(value) =>
                        setMapping((prev) => ({ ...prev, [col.name]: value }))
                      }
                    >
                      <SelectTrigger
                        aria-label={t("mapColumnAria", { column: col.name })}
                        size="xs"
                        className="w-40 text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SKIP}>{t("skipColumn")}</SelectItem>
                        {/* ponytail: duplicate CSV headers collide on value —
                            rare, and Stage 1 doesn't consume the mapping yet. */}
                        {headers.map((h, i) => (
                          <SelectItem key={`${h}-${i}`} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {preview && previewRows.length > 0 && (
            <div
              role="region"
              aria-label={t("previewRegionAria")}
              className="space-y-2"
            >
              <div className="text-xs font-medium text-muted-foreground">
                {t("previewLabel")}
              </div>
              <div className="max-h-64 overflow-auto rounded border border-border bg-background">
                <table className="w-full min-w-max border-collapse text-xs">
                  <thead className="bg-secondary text-muted-foreground">
                    <tr>
                      {headers.map((h, i) => (
                        <th
                          key={`${h}-${i}`}
                          className="border-b border-border px-3 py-2 text-left font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, rowIndex) => (
                      <tr key={rowIndex} className="border-b border-border/60">
                        {headers.map((_, columnIndex) => (
                          <td
                            key={columnIndex}
                            className="max-w-64 truncate px-3 py-2"
                            title={row[columnIndex] ?? ""}
                          >
                            {row[columnIndex] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </DialogShell.Body>

        <DialogShell.Footer>
          <DialogFooter className="px-4 py-3">
            {preview && (
              <span className="mr-auto text-2xs text-muted-foreground">
                {t("mappingLabel", {
                  mapped: mappedCount,
                  total: columns.length,
                })}
              </span>
            )}
            {committing !== null ? (
              <>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  {t("importing", { count: committing.total })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void cancelImport()}
                >
                  {t("cancelImport")}
                </Button>
              </>
            ) : confirming ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming(false)}
                >
                  {t("back")}
                </Button>
                <Button size="sm" onClick={() => void runImport()}>
                  {t("confirmImport")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  onClick={() => setConfirming(true)}
                  disabled={!canImport}
                >
                  {t("import")}
                </Button>
                <Button variant="outline" size="sm" onClick={onClose}>
                  {t("close")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogShell.Footer>
      </DialogShell>
    </Dialog>
  );
}
