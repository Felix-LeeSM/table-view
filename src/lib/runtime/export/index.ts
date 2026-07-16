import { save } from "@tauri-apps/plugin-dialog";
import {
  exportGridRows,
  type ExportContext,
  type ExportFormat,
  type ExportSummary,
} from "@/lib/tauri";
import { toast } from "@/lib/runtime/toast";
import i18n from "@lib/i18n";
import { buildExportFilename } from "@/lib/export/filename";

export type { ExportContext, ExportFormat, ExportSummary } from "@/lib/tauri";
export { buildExportFilename } from "@/lib/export/filename";

const FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  csv: { name: "CSV", extensions: ["csv"] },
  tsv: { name: "TSV", extensions: ["tsv"] },
  sql: { name: "SQL INSERT", extensions: ["sql"] },
  json: { name: "JSON Array", extensions: ["json"] },
};

export interface RunExportArgs {
  format: ExportFormat;
  context: ExportContext;
  headers: string[];
  rows: unknown[][];
  /** Optional id for cooperative cancellation via the query-token registry. */
  exportId?: string | null;
  /**
   * #1448 F15 — cumulative rows written, reported after each streamed chunk of
   * a large (>25k-row) export so callers can surface a live count.
   */
  onProgress?: (rowsWritten: number) => void;
  /** Injected for tests so file-name timestamps stay deterministic. */
  now?: Date;
}

export type RunExportResult =
  | { kind: "ok"; path: string; summary: ExportSummary }
  | { kind: "cancelled" };

/**
 * Drive the full export flow: open save dialog → invoke Rust handler →
 * surface success / error toast. Dialog cancel is silent (returns
 * `{ kind: "cancelled" }` with no toast). I/O errors raise a destructive
 * toast carrying the backend message.
 *
 * #1269 — a Stop-button cancel (fired via `cancelQuery(exportId)`) makes the
 * backend abort its write loop with a "cancelled" error. That is user intent,
 * not a failure, so we recognise it and return `{ kind: "cancelled" }` with an
 * informational toast instead of the destructive I/O-failure toast.
 */
export async function runExport(args: RunExportArgs): Promise<RunExportResult> {
  const {
    format,
    context,
    headers,
    rows,
    exportId = null,
    onProgress,
    now,
  } = args;
  const defaultPath = buildExportFilename(context, format, now ?? new Date());
  const filter = FILTERS[format];

  const target = await save({
    defaultPath,
    filters: [filter],
  });

  if (target === null || target === undefined) {
    return { kind: "cancelled" };
  }

  try {
    const summary = await exportGridRows(
      format,
      target,
      headers,
      rows,
      context,
      exportId,
      onProgress,
    );
    toast.success(
      i18n.t("export:gridRowsExported", {
        count: summary.rows_written,
        formatted: summary.rows_written.toLocaleString(),
      }),
    );
    return { kind: "ok", path: target, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(message)) {
      toast.info(i18n.t("export:cancelled"));
      return { kind: "cancelled" };
    }
    toast.error(i18n.t("export:failed", { message }));
    throw err;
  }
}
