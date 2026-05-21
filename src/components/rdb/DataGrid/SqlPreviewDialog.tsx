import { X } from "lucide-react";
import type { DataGridEditState } from "@components/datagrid/useDataGridEdit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import PreviewCopyButton from "@components/ui/dialog/PreviewCopyButton";
import ExecuteButton from "@components/ui/ExecuteButton";
import SqlSyntax from "@components/shared/SqlSyntax";

interface SqlPreviewDialogProps {
  editState: Pick<
    DataGridEditState,
    "sqlPreview" | "setSqlPreview" | "handleExecuteCommit" | "commitError"
  >;
  connectionEnvironment: string | null;
  connectionLabel: string | null;
}

export function SqlPreviewDialog({
  editState,
  connectionEnvironment,
  connectionLabel,
}: SqlPreviewDialogProps) {
  return (
    <Dialog
      open={!!editState.sqlPreview}
      onOpenChange={(open) => !open && editState.setSqlPreview(null)}
    >
      <DialogContent
        className="w-dialog-xl max-h-[80vh] bg-background p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>SQL Preview</DialogTitle>
          <DialogDescription>Preview SQL before executing</DialogDescription>
        </DialogHeader>
        <div
          className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              editState.handleExecuteCommit();
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              SQL Preview
            </h3>
            <div className="flex items-center gap-1">
              <PreviewCopyButton
                text={editState.sqlPreview?.join(";\n") ?? ""}
                ariaLabel="Copy SQL to clipboard"
              />
              <button
                className="rounded p-1 hover:bg-muted"
                onClick={() => editState.setSqlPreview(null)}
                aria-label="Close SQL preview"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            {editState.sqlPreview?.map((sql, i) => {
              const isFailed = editState.commitError?.statementIndex === i;
              return (
                <pre
                  key={i}
                  className={
                    isFailed
                      ? "mb-2 whitespace-pre-wrap break-all rounded border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive"
                      : "mb-2 whitespace-pre-wrap break-all rounded bg-secondary p-2 text-xs text-secondary-foreground"
                  }
                >
                  <SqlSyntax sql={sql} />
                </pre>
              );
            })}
            {editState.commitError && (
              <div
                role="alert"
                aria-live="assertive"
                className="mt-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="datagrid-commit-error"
              >
                <div className="font-semibold">
                  executed: {editState.commitError.statementIndex}, failed at:{" "}
                  {editState.commitError.statementIndex + 1} of{" "}
                  {editState.commitError.statementCount}
                </div>
                <div className="mt-1 break-words">
                  {editState.commitError.message}
                </div>
                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded border border-destructive/30 bg-background/40 p-2 text-xs font-mono">
                  {editState.commitError.sql}
                </pre>
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-border px-4 py-3">
            <button
              className="rounded bg-muted px-3 py-1.5 text-xs text-secondary-foreground hover:bg-secondary"
              onClick={() => editState.setSqlPreview(null)}
            >
              Cancel
            </button>
            <ExecuteButton
              severity="warn"
              environment={connectionEnvironment}
              connectionLabel={connectionLabel}
              loading={false}
              disabled={false}
              onClick={editState.handleExecuteCommit}
              ariaLabel="Execute SQL"
              autoFocus
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
