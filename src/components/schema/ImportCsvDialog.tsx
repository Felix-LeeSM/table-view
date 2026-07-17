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
import { previewCsvImport, type CsvPreview } from "@lib/tauri/import";
import { useSchemaStore } from "@stores/schemaStore";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";
import type { ColumnInfo } from "@/types/schema";

/**
 * `ImportCsvDialog` — issue #1639 Stage 1. A **read-only** CSV import wizard:
 * pick a file, preview its parsed headers + sample rows (streamed backend
 * command `preview_csv_import`), and map target-table columns to CSV headers.
 * This stage performs **zero DB writes** — there is deliberately no commit
 * button; the INSERT commit path is a follow-up sub-issue (#1640). The engine
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
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    try {
      const next = await previewCsvImport(path, { hasHeader: header });
      setPreview(next);
      setMapping(autoMapColumns(columns, next.headers));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

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

  const headers = preview?.headers ?? [];
  const previewRows = preview?.preview_rows ?? [];
  const mappedCount = useMemo(
    () => Object.values(mapping).filter((h) => h !== SKIP).length,
    [mapping],
  );

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
              />
              {t("hasHeader")}
            </label>
            {preview && (
              <span className="text-xs text-muted-foreground">
                {t("rowCount", { count: preview.row_count })}
              </span>
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
            {/* Stage 1 is read-only — no commit button. The INSERT commit path
                (and its Import button) lands in #1640. */}
            <span className="mr-auto text-2xs italic text-muted-foreground">
              {t("commitPending")}
            </span>
            <Button variant="outline" size="sm" onClick={onClose}>
              {t("close")}
            </Button>
          </DialogFooter>
        </DialogShell.Footer>
      </DialogShell>
    </Dialog>
  );
}
