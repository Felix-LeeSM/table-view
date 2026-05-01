import { save } from "@tauri-apps/plugin-dialog";
import {
  exportGridRows,
  type ExportContext,
  type ExportFormat,
  type ExportSummary,
} from "@/lib/tauri";
import { toast } from "@/lib/toast";
import { buildExportFilename } from "./filename";

export type { ExportContext, ExportFormat, ExportSummary } from "@/lib/tauri";
export { buildExportFilename } from "./filename";

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
  /** Optional id for cooperative cancellation via the Sprint 180 registry. */
  exportId?: string | null;
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
 */
export async function runExport(args: RunExportArgs): Promise<RunExportResult> {
  const { format, context, headers, rows, exportId = null, now } = args;
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
    );
    toast.success(
      `Exported ${summary.rows_written.toLocaleString()} row${summary.rows_written === 1 ? "" : "s"}`,
    );
    return { kind: "ok", path: target, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast.error(`Export failed: ${message}`);
    throw err;
  }
}
