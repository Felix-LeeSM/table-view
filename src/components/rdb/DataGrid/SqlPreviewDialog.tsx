import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { useDelayedFlag } from "@/hooks/useDelayedFlag";

// Issue #1111/#1141 — same reflexive-Enter absorption window as
// ConfirmDestructiveDialog: the Execute button is disabled for a short
// window after the preview opens.
const EXECUTE_ARM_DELAY_MS = 150;

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
  const { t } = useTranslation("rdb");
  const open = !!editState.sqlPreview;
  const armed = useDelayedFlag(open, EXECUTE_ARM_DELAY_MS);
  const executeRef = useRef<HTMLButtonElement>(null);
  // Move focus onto Execute once it arms so the muscle-memory Enter confirms
  // via the button's native activation — a reflexive Enter during the arm
  // window (Execute disabled) lands on Cancel/Close, never the commit.
  useEffect(() => {
    if (armed) executeRef.current?.focus();
  }, [armed]);
  // Guards against a second Enter/click re-firing the commit while the
  // first execution is still in flight (#1141 double-execution).
  const [executing, setExecuting] = useState(false);
  const runExecute = async () => {
    if (executing) return;
    setExecuting(true);
    try {
      await editState.handleExecuteCommit();
    } finally {
      setExecuting(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && editState.setSqlPreview(null)}
    >
      <DialogContent
        className="w-dialog-xl max-h-[80vh] bg-background p-0"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("sqlPreviewDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("sqlPreviewDialog.description")}
          </DialogDescription>
        </DialogHeader>
        {/*
          No dialog-wide Enter handler: it previously (#1141) executed the
          destructive commit even when focus was on Cancel/Close. Enter now
          only fires the commit via the autoFocus'd Execute button's native
          activation, which is gated by the arm/executing disabled state.
        */}
        <div className="flex max-h-[80vh] flex-col rounded-lg border border-border bg-background shadow-xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">
              {t("sqlPreviewDialog.title")}
            </h3>
            <div className="flex items-center gap-1">
              <PreviewCopyButton
                text={editState.sqlPreview?.join(";\n") ?? ""}
                ariaLabel={t("sqlPreviewDialog.copySqlAria")}
              />
              <button
                className="rounded p-1 hover:bg-muted"
                onClick={() => editState.setSqlPreview(null)}
                aria-label={t("sqlPreviewDialog.closeAria")}
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
                  {t("sqlPreviewDialog.commitErrorSummary", {
                    executed: editState.commitError.statementIndex,
                    failedAt: editState.commitError.statementIndex + 1,
                    total: editState.commitError.statementCount,
                  })}
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
              {t("sqlPreviewDialog.cancel")}
            </button>
            <ExecuteButton
              severity="warn"
              environment={connectionEnvironment}
              connectionLabel={connectionLabel}
              loading={executing}
              disabled={!armed || executing}
              onClick={runExecute}
              ariaLabel={t("sqlPreviewDialog.executeAria")}
              autoFocus
              ref={executeRef}
            />
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
