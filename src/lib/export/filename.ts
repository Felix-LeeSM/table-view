import type { ExportContext, ExportFormat } from "@/lib/tauri";

const EXTENSIONS: Record<ExportFormat, string> = {
  csv: "csv",
  tsv: "tsv",
  sql: "sql",
  json: "json",
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function timestamp(now: Date): string {
  return (
    `${now.getFullYear()}` +
    pad(now.getMonth() + 1) +
    pad(now.getDate()) +
    "-" +
    pad(now.getHours()) +
    pad(now.getMinutes()) +
    pad(now.getSeconds())
  );
}

function contextSlug(context: ExportContext): string {
  switch (context.kind) {
    case "table":
      return `${context.schema}.${context.name}`;
    case "collection":
      return context.name;
    case "query":
      return "query";
  }
}

/**
 * Suggest the default filename for a save dialog. Pure: callers inject `now`
 * for deterministic tests. The slug uses dot-separated `schema.table` for
 * RDB so users immediately recognise the source on disk.
 */
export function buildExportFilename(
  context: ExportContext,
  format: ExportFormat,
  now: Date,
): string {
  return `${contextSlug(context)}_${timestamp(now)}.${EXTENSIONS[format]}`;
}
