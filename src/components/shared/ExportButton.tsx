import { useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { runExport } from "@/lib/export";
import type { ExportContext, ExportFormat } from "@/lib/tauri";
import { cn } from "@/lib/utils";

const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: "CSV",
  tsv: "TSV",
  sql: "SQL INSERT",
  json: "JSON",
};

const FORMATS_BY_KIND: Record<ExportContext["kind"], ExportFormat[]> = {
  // RDB table view: row data is structured + has full schema/table context.
  table: ["csv", "tsv", "sql"],
  // Mongo collection view: BSON-aware JSON is the lossless export.
  collection: ["json", "csv", "tsv"],
  // Arbitrary SELECT: SQL only when source_table inference succeeds.
  query: ["csv", "tsv", "sql"],
};

export interface ExportButtonProps {
  context: ExportContext;
  headers: string[];
  /**
   * Lazy row provider. Called only after the user picks a format so
   * paginated surfaces can collect their visible rows on demand.
   */
  getRows: () => Promise<unknown[][]> | unknown[][];
  /** Formats that should appear disabled (with tooltip explaining why). */
  disabledFormats?: ExportFormat[];
  /** Optional cancel-token id forwarded to the Sprint 180 registry. */
  exportId?: string | null;
  className?: string;
}

export function ExportButton({
  context,
  headers,
  getRows,
  disabledFormats = [],
  exportId = null,
  className,
}: ExportButtonProps) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const formats = FORMATS_BY_KIND[context.kind];

  async function handleSelect(format: ExportFormat) {
    if (disabledFormats.includes(format) || running) return;
    setOpen(false);
    setRunning(true);
    try {
      const rows = await Promise.resolve(getRows());
      await runExport({ format, context, headers, rows, exportId });
    } catch {
      // toast surfaced inside runExport; swallow so the button can re-enable.
    } finally {
      setRunning(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={running}
          aria-label="Export"
          data-testid="export-button"
          className={cn("gap-1.5", className)}
        >
          <Download className="size-3.5" aria-hidden />
          <span>Export</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 p-1" role="menu">
        {formats.map((format) => {
          const disabled = disabledFormats.includes(format);
          return (
            <button
              type="button"
              key={format}
              role="menuitem"
              aria-disabled={disabled || undefined}
              disabled={disabled}
              onClick={() => handleSelect(format)}
              title={
                disabled
                  ? "Single-table SELECT only"
                  : `Export as ${FORMAT_LABELS[format]}`
              }
              className={cn(
                "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-sm",
                "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none",
                disabled &&
                  "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              <span>{FORMAT_LABELS[format]}</span>
              <span className="text-xs text-muted-foreground">.{format}</span>
            </button>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}
