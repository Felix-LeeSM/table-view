import { useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Download, Loader2, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { runExport } from "@/lib/runtime/export";
import { cancelQuery } from "@/lib/tauri";
import type { ExportContext, ExportFormat } from "@/lib/tauri";
import { cn } from "@/lib/utils";

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
  /** Per-format disabled tooltip. Falls back to the single-table reason. */
  disabledFormatReasons?: Partial<Record<ExportFormat, string>>;
  /** Disable the whole export action when the current surface has no rows. */
  disabled?: boolean;
  /** Tooltip for a disabled export trigger. */
  disabledReason?: string;
  /** Optional cancel-token id forwarded to the query-token registry. */
  exportId?: string | null;
  className?: string;
}

export function ExportButton({
  context,
  headers,
  getRows,
  disabledFormats = [],
  disabledFormatReasons = {},
  disabled = false,
  disabledReason,
  exportId = null,
  className,
}: ExportButtonProps) {
  const { t } = useTranslation("shared");
  const resolvedDisabledReason = disabledReason ?? t("export.nothingToExport");
  const FORMAT_LABELS: Record<ExportFormat, string> = {
    csv: t("export.csv"),
    tsv: t("export.tsv"),
    sql: t("export.sql"),
    json: t("export.json"),
  };
  const DEFAULT_DISABLED_REASON = t("export.singleTableOnly");
  const [running, setRunning] = useState(false);
  // #1448 F15 — cumulative rows written, shown next to the Stop affordance while
  // a large (>25k-row) export streams; null for the instant single-shot path.
  const [progress, setProgress] = useState<number | null>(null);
  const formats = FORMATS_BY_KIND[context.kind];
  // #1269 — id of the in-flight export so the Stop button can fire the same
  // cooperative `cancelQuery` the query tab uses. A caller-supplied `exportId`
  // wins; otherwise we mint one per run so cancellation always has a token.
  const activeExportIdRef = useRef<string | null>(null);

  async function handleSelect(format: ExportFormat) {
    if (disabled || disabledFormats.includes(format) || running) return;
    const runExportId = exportId ?? `export-${crypto.randomUUID()}`;
    activeExportIdRef.current = runExportId;
    setRunning(true);
    try {
      const rows = await Promise.resolve(getRows());
      await runExport({
        format,
        context,
        headers,
        rows,
        exportId: runExportId,
        onProgress: setProgress,
      });
    } catch {
      // toast surfaced inside runExport; swallow so the button can re-enable.
    } finally {
      setRunning(false);
      setProgress(null);
      activeExportIdRef.current = null;
    }
  }

  function handleCancel() {
    const id = activeExportIdRef.current;
    if (id === null) return;
    void cancelQuery(id).catch(() => {
      // Best-effort — an export that already finished has no token to fire.
    });
  }

  // #1269 — while an export streams, swap the trigger for the same Stop
  // affordance the query tab uses (Square + spinner). Cooperative cancel: the
  // in-process write loop checks the token between rows, so the abort is
  // effective (no server round-trip needed).
  if (running) {
    return (
      <span className="flex items-center gap-1">
        {/* #1448 F15 — live row count for a streamed large export. Decorative
            (aria-hidden): the Stop button already carries the export/cancel
            label, and the surrounding status region announces completion. */}
        {progress !== null && (
          <span
            className="text-3xs tabular-nums text-muted-foreground"
            data-testid="export-progress"
            aria-hidden
          >
            {progress.toLocaleString()}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleCancel}
          aria-label={t("export.cancelAria")}
          title={t("export.cancelTooltip")}
          data-testid="export-cancel"
          className={cn("text-muted-foreground", className)}
        >
          <Square className="text-destructive" size={12} aria-hidden />
          <Loader2 className="animate-spin" size={12} aria-hidden />
        </Button>
      </span>
    );
  }

  // Radix DropdownMenu (already bundled via the unified `radix-ui` package)
  // supplies the WAI-ARIA menu keyboard model the old `role="menu"` popover
  // only claimed: ArrowUp/Down roving, Home/End, typeahead, Escape, single
  // tab stop. No new dependency, no hand-rolled menu.
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={disabled || running}
          aria-label={t("export.label")}
          title={disabled ? resolvedDisabledReason : t("export.label")}
          data-testid="export-button"
          className={cn("text-muted-foreground", className)}
        >
          <Download size={12} aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={cn(
            "z-50 w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          {formats.map((format) => {
            const itemDisabled = disabledFormats.includes(format);
            return (
              <DropdownMenu.Item
                key={format}
                disabled={itemDisabled}
                onSelect={() => handleSelect(format)}
                title={
                  itemDisabled
                    ? (disabledFormatReasons[format] ?? DEFAULT_DISABLED_REASON)
                    : t("export.exportAs", { label: FORMAT_LABELS[format] })
                }
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1 text-left text-xs outline-none select-none",
                  "focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground",
                  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[disabled]:bg-transparent",
                )}
              >
                <span>{FORMAT_LABELS[format]}</span>
                <span className="text-3xs text-muted-foreground">
                  .{format}
                </span>
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
