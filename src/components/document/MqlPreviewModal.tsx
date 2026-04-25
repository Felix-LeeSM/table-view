import { Loader2, Play, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";

/**
 * Sprint 87 — MQL preview modal for the document paradigm.
 *
 * Mirrors the RDB SQL preview dialog (`DataGrid.tsx` inline Dialog) but is
 * scoped to the document grid so MongoDB-specific preview semantics (per-row
 * `errors`, disabled Execute when no commands are generated) have a dedicated
 * surface. Consumes the `MqlPreview` shape produced by
 * `src/lib/mongo/mqlGenerator.ts` (Sprint 86): callers pass `previewLines` and
 * `errors` as flat lists plus `onExecute` / `onCancel` handlers.
 *
 * Keyboard:
 * - Enter (outside inputs) → Execute.
 * - Esc → Cancel (Radix Dialog handles via `onOpenChange`).
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
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="w-dialog-xl max-h-[80vh] bg-background p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>MQL Preview</DialogTitle>
          <DialogDescription>
            Preview MongoDB commands before executing
          </DialogDescription>
        </DialogHeader>
        <div
          className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl"
          onKeyDown={(e) => {
            // Enter triggers Execute unless focus is inside a text input/area
            // or Execute is currently disabled. This matches the RDB preview
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
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              MQL Preview
            </h3>
            <button
              type="button"
              className="rounded p-1 hover:bg-muted"
              onClick={onCancel}
              aria-label="Close MQL preview"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-auto p-4">
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
                className="mt-3 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive"
              >
                <p className="mb-1 font-semibold">
                  {errors.length} row{errors.length !== 1 ? "s" : ""} skipped:
                </p>
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.map((err, idx) => (
                    <li key={`${err.row}-${idx}`}>
                      row {err.row}: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-border px-4 py-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => void onExecute()}
              disabled={executeDisabled}
              autoFocus
              aria-label="Execute MQL commands"
            >
              {loading ? <Loader2 className="animate-spin" /> : <Play />}
              {loading ? "Executing..." : "Execute"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
