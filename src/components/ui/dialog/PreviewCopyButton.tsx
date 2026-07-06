import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@components/ui/button";
import {
  useCopyToClipboard,
  type CopyStatus,
} from "@lib/runtime/useCopyToClipboard";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sprint 252 (2026-05-09) — Reusable Copy button for Preview dialogs.
//
// Why extract: PreviewDialog (`src/components/ui/dialog/PreviewDialog.tsx`)
// and DataGrid's inline SQL preview (`src/components/rdb/DataGrid.tsx`) both
// need the same affordance — testid-stable Copy button + transient
// "Copied" / "Copy failed" feedback + unmount-safe setTimeout cleanup. Two
// separate copies would drift; one component keeps the affordance here.
//
// Issue #1369 — the state machine (idle → success 1500 ms → idle, idle →
// failure 2000 ms → idle, timer cleared on unmount / every new click) now
// lives in the shared `useCopyToClipboard` hook so CellDetailDialog,
// ViewStructurePanel, and ImportExportDialog reuse the same behavior.
// ---------------------------------------------------------------------------

export interface PreviewCopyButtonProps {
  /** Text to write to the clipboard. Empty/whitespace → button NOT rendered. */
  text: string;
  /** ARIA label override. Defaults to "Copy". */
  ariaLabel?: string;
  /** Optional className passthrough for the underlying Button. */
  className?: string;
}

export default function PreviewCopyButton({
  text,
  ariaLabel,
  className,
}: PreviewCopyButtonProps) {
  const { t } = useTranslation("ui");
  const { status, copy } = useCopyToClipboard();
  const LABEL: Record<CopyStatus, string> = {
    idle: t("copy"),
    success: t("copied"),
    failure: t("copyFailed"),
  };
  const resolvedAriaLabel = ariaLabel ?? t("copy");

  // AC-252-04: empty/whitespace-only text → render nothing. Caller does not
  // need a separate disabled affordance; the button simply absents itself.
  if (text.trim() === "") return null;

  const Icon = status === "success" ? Check : Copy;
  const label = LABEL[status];

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => void copy(text)}
      data-testid="preview-dialog-copy"
      aria-label={resolvedAriaLabel}
      className={cn("gap-1.5", className)}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}
