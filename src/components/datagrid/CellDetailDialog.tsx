import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { Copy, Check } from "lucide-react";
import { Button } from "@components/ui/button";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";
import { safeStringifyCell } from "@lib/jsonCell";

export interface CellDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: unknown;
  columnName: string;
  dataType?: string;
}

/**
 * Render a cell value as the most useful textual form for inspection.
 * - null becomes the literal "NULL" so the user can distinguish it from "".
 * - objects (including arrays) are pretty-printed JSON.
 * - everything else falls back to String(value).
 */
function renderCellText(data: unknown): string {
  if (data == null) return "NULL";
  // Sprint 305 — Decimal / BigInt 는 ADR 0026 의 precision-preserving cell
  // type. Decimal 은 `typeof === "object"` 라 generic branch 가 `{}` 로
  // emit, BigInt 는 raw JSON.stringify 가 throw → 둘 다 명시 처리.
  if (data instanceof Decimal) return data.toString();
  if (typeof data === "bigint") return data.toString();
  if (typeof data === "object") return safeStringifyCell(data, 2);
  return String(data);
}

/**
 * Detail viewer for a single cell. Useful when the truncated grid value
 * makes long text or nested JSON impossible to read in place. Read-only;
 * users can copy the value to the clipboard with one click. Built on the
 * `PreviewDialog` preset (no confirm footer; absolute X is the only
 * dismiss affordance).
 */
export default function CellDetailDialog({
  open,
  onOpenChange,
  data,
  columnName,
  dataType,
}: CellDetailDialogProps) {
  const { t } = useTranslation("datagrid");
  const [copied, setCopied] = useState(false);

  const text = useMemo(() => renderCellText(data), [data]);
  const charCount = text.length;
  const lineCount = text === "" ? 0 : text.split("\n").length;

  const handleCopy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        // Clipboard API may fail in some environments; silently ignore
      });
  };

  if (!open) return null;

  return (
    <PreviewDialog
      title={
        <span className="flex items-center gap-2">
          <span>{t("cellDetailTitle")}</span>
          <span className="font-mono text-primary">{columnName}</span>
          {dataType && (
            <span className="text-xs font-normal text-muted-foreground">
              ({dataType})
            </span>
          )}
        </span>
      }
      className="sm:max-w-3xl"
      onCancel={() => onOpenChange(false)}
      preview={
        <>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <div className="text-xs text-muted-foreground">
              {t("charCount", { count: charCount })} ·{" "}
              {t("lineCount", { count: lineCount })}
            </div>
            <Button
              variant="ghost"
              size="xs"
              onClick={handleCopy}
              aria-label={t("copyCellAria")}
            >
              {copied ? (
                <>
                  <Check className="text-success" />
                  <span>{t("copied")}</span>
                </>
              ) : (
                <>
                  <Copy />
                  <span>{t("copy")}</span>
                </>
              )}
            </Button>
          </div>

          <div className="max-h-[70vh] overflow-auto rounded border border-border bg-muted/30">
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
              {text === "" ? t("emptyString") : text}
            </pre>
          </div>
        </>
      }
    />
  );
}
