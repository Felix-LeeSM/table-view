import { Loader2, Play } from "lucide-react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";

/**
 * MQL preview modal for the document paradigm. Mirrors the RDB SQL
 * preview dialog but adds Mongo-specific semantics (per-row `errors`,
 * disabled Execute when no commands are generated). Consumes the
 * `MqlPreview` shape from `src/lib/mongo/mqlGenerator.ts`.
 *
 * Keyboard: Enter (outside inputs) → Execute; Esc → Cancel.
 */
export interface MqlPreviewError {
  row: number;
  message: string;
}

export interface MqlPreviewModalProps {
  previewLines: string[];
  errors: MqlPreviewError[];
  onExecute: () => void | Promise<void>;
  onCancel: () => void;
  loading?: boolean;
}

export default function MqlPreviewModal({
  previewLines,
  errors,
  onExecute,
  onCancel,
  loading = false,
}: MqlPreviewModalProps) {
  const executeDisabled = loading || previewLines.length === 0;

  return (
    <PreviewDialog
      title="MQL Preview"
      description="Preview MongoDB commands before executing"
      className="w-dialog-xl max-h-[80vh] bg-background"
      onConfirm={() => void onExecute()}
      onCancel={onCancel}
      loading={loading}
      confirmDisabled={executeDisabled}
      confirmAriaLabel="Execute MQL commands"
      // Sprint 252: Plain-text join — Mongo dialect highlighter absent so
      // SqlSyntax is intentionally NOT wrapped here (AC-252-07 plain
      // fallback). Empty previewLines → joined string is "" → button
      // self-suppresses (AC-252-04).
      copyText={previewLines.join("\n")}
      copyAriaLabel="Copy MQL commands to clipboard"
      confirmLabel={
        <>
          {loading ? <Loader2 className="animate-spin" /> : <Play />}
          {loading ? "Executing..." : "Execute"}
        </>
      }
      preview={
        <div
          className="flex flex-col gap-3"
          onKeyDown={(e) => {
            // Enter → Execute, unless focus is inside a text input/area or the
            // button is disabled.
            if (e.key !== "Enter" || e.shiftKey) return;
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            if (executeDisabled) return;
            e.preventDefault();
            void onExecute();
          }}
        >
          {previewLines.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              No commands to preview.
            </p>
          ) : (
            <pre
              aria-label="MQL commands"
              className="whitespace-pre-wrap break-all rounded bg-secondary p-2 font-mono text-xs text-secondary-foreground"
            >
              {previewLines.join("\n")}
            </pre>
          )}
          {errors.length > 0 && (
            <div
              role="alert"
              aria-label="MQL generation errors"
              className="rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
            >
              <p className="mb-1 font-semibold">
                {errors.length} document{errors.length !== 1 ? "s" : ""}{" "}
                skipped:
              </p>
              <ul className="list-inside list-disc space-y-0.5">
                {errors.map((err, idx) => (
                  <li key={`${err.row}-${idx}`}>
                    document {err.row}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      }
    />
  );
}
