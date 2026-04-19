import { useState, useMemo } from "react";
import { Copy, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";

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
  if (typeof data === "object") {
    try {
      return JSON.stringify(data, null, 2);
    } catch {
      return String(data);
    }
  }
  return String(data);
}

/**
 * Detail viewer for a single cell. Useful when the truncated grid value
 * makes long text or nested JSON impossible to read in place. Read-only;
 * users can copy the value to the clipboard with one click.
 */
export default function CellDetailDialog({
  open,
  onOpenChange,
  data,
  columnName,
  dataType,
}: CellDetailDialogProps) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Cell Detail —</span>
            <span className="font-mono text-primary">{columnName}</span>
            {dataType && (
              <span className="text-xs font-normal text-muted-foreground">
                ({dataType})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between border-b border-border pb-2">
          <div className="text-xs text-muted-foreground">
            {charCount.toLocaleString()} char{charCount !== 1 ? "s" : ""} ·{" "}
            {lineCount.toLocaleString()} line{lineCount !== 1 ? "s" : ""}
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 text-xs text-secondary-foreground hover:bg-muted"
            aria-label="Copy cell value"
          >
            {copied ? (
              <>
                <Check size={12} className="text-emerald-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy size={12} />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>

        <div className="max-h-[70vh] overflow-auto rounded border border-border bg-muted/30">
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-xs leading-5 text-foreground">
            {text === "" ? "(empty string)" : text}
          </pre>
        </div>
      </DialogContent>
    </Dialog>
  );
}
