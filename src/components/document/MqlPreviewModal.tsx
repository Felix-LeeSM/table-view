import { Loader2, Play } from "lucide-react";
import PreviewDialog from "@components/ui/dialog/PreviewDialog";

/**
 * Sprint 87 — MQL preview modal for the document paradigm.
 *
 * Mirrors the RDB SQL preview dialog (`SqlPreviewDialog`) but is scoped to
 * the document grid so MongoDB-specific preview semantics (per-row `errors`,
 * disabled Execute when no commands are generated) have a dedicated
 * surface. Consumes the `MqlPreview` shape produced by
 * `src/lib/mongo/mqlGenerator.ts` (Sprint 86): callers pass `previewLines`
 * and `errors` as flat lists plus `onExecute` / `onCancel` handlers.
 *
 * Keyboard:
 * - Enter (outside inputs) → Execute.
 * - Esc → Cancel (Radix Dialog handles via `onOpenChange`).
 *
 * Sprint 96: migrated to the `PreviewDialog` preset. The Enter-to-execute
 * affordance is preserved by keeping a `keydown` handler on the preview
 * body itself (the preset doesn't own keyboard shortcuts).
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
            // Enter triggers Execute unless focus is inside a text input/area
            // or Execute is currently disabled. Mirrors the RDB preview
            // modal's Enter=Execute affordance.
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
