import type { ExportContext, ExportFormat } from "@/lib/tauri";
import type { FileAnalyticsSourceMetadata } from "@/types/fileAnalytics";

interface ParsedQuerySource {
  schema: string;
  table: string;
}

interface QueryExportBoundary {
  context: ExportContext;
  disabledFormats: ExportFormat[];
  disabledReasons: Partial<Record<ExportFormat, string>>;
  registeredFileAlias: boolean;
  readOnlyReason: string | null;
}

const REGISTERED_FILE_SQL_DISABLED_REASON =
  "SQL INSERT export is disabled for DuckDB registered file sources. Use CSV or TSV to export the current grid rows.";

const REGISTERED_FILE_READ_ONLY_REASON =
  "DuckDB registered file sources are active-session query sources. Export current rows as CSV or TSV.";

function isRegisteredFileAlias(
  table: string | undefined,
  sources: FileAnalyticsSourceMetadata[] | undefined,
): boolean {
  if (!table || !sources || sources.length === 0) return false;
  const normalizedTable = table.toLowerCase();
  return sources.some(
    (metadata) => metadata.source.alias.toLowerCase() === normalizedTable,
  );
}

export function resolveQueryExportBoundary(
  dbType: string | undefined,
  parsed: ParsedQuerySource | null,
  sources: FileAnalyticsSourceMetadata[] | undefined,
): QueryExportBoundary {
  const registeredFileAlias =
    dbType === "duckdb" && isRegisteredFileAlias(parsed?.table, sources);
  const sourceTable =
    parsed && !registeredFileAlias
      ? { schema: parsed.schema, name: parsed.table }
      : null;

  return {
    context: { kind: "query", source_table: sourceTable },
    disabledFormats: sourceTable ? [] : ["sql"],
    disabledReasons: registeredFileAlias
      ? { sql: REGISTERED_FILE_SQL_DISABLED_REASON }
      : {},
    registeredFileAlias,
    readOnlyReason: registeredFileAlias
      ? REGISTERED_FILE_READ_ONLY_REASON
      : null,
  };
}
