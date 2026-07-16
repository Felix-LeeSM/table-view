import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  FileSearch,
  Loader2,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Button } from "@components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import ConfirmDestructiveDialog from "@components/workspace/ConfirmDestructiveDialog";
import {
  executeSearchDeleteByQuery,
  planSearchDeleteByQuery,
} from "@lib/tauri/search";
import { getTauriErrorMessage } from "@lib/tauri/error";
import {
  formatSearchUiError,
  type SearchUiError,
} from "@lib/search/searchUiError";
import { DriverErrorHint } from "@components/errors/DriverErrorHint";
import { getDeleteByQueryPreviewTargetError } from "@lib/search/searchTargetPolicy";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { useConnectionStore } from "@stores/connectionStore";
import type { StatementAnalysis } from "@/lib/sql/sqlSafety";
import type {
  SearchDeleteByQueryResult,
  SearchDestructiveOperationPlan,
} from "@/types/search";

export interface SearchDeleteByQueryPreviewDialogProps {
  open: boolean;
  connectionId: string;
  target: string;
  supported: boolean;
  docsCount?: number;
  onOpenChange: (open: boolean) => void;
}

type PlanState =
  | { status: "idle"; plan: null; error: null }
  | { status: "loading"; plan: null; error: null }
  | {
      status: "loaded";
      plan: SearchDestructiveOperationPlan;
      body: Record<string, unknown>;
      error: null;
    }
  | { status: "error"; plan: null; error: SearchUiError };

type ExecState =
  | { status: "idle"; result: null; error: null }
  | { status: "running"; result: null; error: null }
  | { status: "done"; result: SearchDeleteByQueryResult; error: null }
  | { status: "error"; result: null; error: SearchUiError };

const execIdle: ExecState = { status: "idle", result: null, error: null };

const defaultBody = JSON.stringify(
  {
    query: { match_all: {} },
  },
  null,
  2,
);

export function SearchDeleteByQueryPreviewDialog({
  open,
  connectionId,
  target,
  supported,
  docsCount,
  onOpenChange,
}: SearchDeleteByQueryPreviewDialogProps) {
  const { t } = useTranslation("search");
  const [bodyText, setBodyText] = useState(defaultBody);
  const [planState, setPlanState] = useState<PlanState>({
    status: "idle",
    plan: null,
    error: null,
  });
  const [execState, setExecState] = useState<ExecState>(execIdle);
  // Safe Mode confirm reason (non-null ⇔ ConfirmDestructiveDialog open).
  const [confirmReason, setConfirmReason] = useState<string | null>(null);
  const safeModeGate = useSafeModeGate(connectionId);
  const connection = useConnectionStore((s) =>
    s.connections.find((candidate) => candidate.id === connectionId),
  );
  const confirmEnvironment =
    connection?.environment === "production" ? "production" : "non-production";
  const connectionLabel = connection?.name ?? connectionId;
  const targetError = useMemo(
    () => getDeleteByQueryPreviewTargetError(target),
    [target],
  );
  const canPlan =
    supported && targetError === null && planState.status !== "loading";

  useEffect(() => {
    if (!open) return;
    setBodyText(defaultBody);
    setPlanState({ status: "idle", plan: null, error: null });
    setExecState(execIdle);
    setConfirmReason(null);
  }, [open, target]);

  function onBodyChange(next: string) {
    setBodyText(next);
    // A body edit invalidates the previewed plan and any prior result so the
    // Delete affordance always matches the currently-previewed query (#1076).
    setPlanState({ status: "idle", plan: null, error: null });
    setExecState(execIdle);
    setConfirmReason(null);
  }

  async function handlePlan() {
    if (!supported) {
      setPlanState({
        status: "error",
        plan: null,
        error: formatSearchUiError(
          "deletePreview",
          t("deletePreview.errorUnsupported"),
        ),
      });
      return;
    }
    if (targetError) {
      setPlanState({
        status: "error",
        plan: null,
        error: formatSearchUiError("deletePreview", targetError),
      });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch (err) {
      setPlanState({
        status: "error",
        plan: null,
        error: formatSearchUiError("deletePreview", err),
      });
      return;
    }
    if (!isRecord(body)) {
      setPlanState({
        status: "error",
        plan: null,
        error: formatSearchUiError(
          "deletePreview",
          t("deletePreview.errorNotObject"),
        ),
      });
      return;
    }

    setPlanState({ status: "loading", plan: null, error: null });
    setExecState(execIdle);
    try {
      const plan = await planSearchDeleteByQuery(connectionId, {
        indexPattern: target.trim(),
        body,
        previewOnly: true,
        safety: {
          acknowledgedRisk: false,
          allowWildcard: false,
        },
      });
      setPlanState({ status: "loaded", plan, body, error: null });
    } catch (err) {
      setPlanState({
        status: "error",
        plan: null,
        error: formatSearchUiError("deletePreview", getTauriErrorMessage(err)),
      });
    }
  }

  function requestExecute() {
    if (planState.status !== "loaded") return;
    const count = planState.plan.estimatedDocumentCount ?? 0;
    // Delete-by-query is unconditionally destructive; feed the shared Safe Mode
    // gate a danger analysis so the SAME matrix (prod / strict → confirm) that
    // guards SQL/Mongo drives whether the confirm dialog appears (#1076).
    const analysis: StatementAnalysis = {
      kind: "dml-delete",
      severity: "danger",
      reasons: [
        t("deletePreview.confirmReason", {
          count,
          target: planState.plan.target,
        }),
      ],
    };
    const decision = safeModeGate.decide(analysis);
    if (decision.action === "confirm") {
      setConfirmReason(decision.reason);
      return;
    }
    // Allow tier (non-production warn / off): no confirm dialog — the preview
    // plan step was the deliberate gate. Backend re-decides independently.
    void runExecute(false);
  }

  async function runExecute(safetyConfirmed: boolean) {
    if (planState.status !== "loaded") return;
    const { body, plan } = planState;
    setConfirmReason(null);
    setExecState({ status: "running", result: null, error: null });
    try {
      const result = await executeSearchDeleteByQuery(
        connectionId,
        {
          indexPattern: plan.target,
          body,
          previewOnly: false,
          safety: { acknowledgedRisk: safetyConfirmed, allowWildcard: false },
        },
        safetyConfirmed,
      );
      setExecState({ status: "done", result, error: null });
    } catch (err) {
      setExecState({
        status: "error",
        result: null,
        error: formatSearchUiError("deleteExecute", getTauriErrorMessage(err)),
      });
    }
  }

  const planCount =
    planState.status === "loaded"
      ? planState.plan.estimatedDocumentCount
      : undefined;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-h-[90vh] overflow-hidden sm:max-w-2xl"
          tone="warning"
        >
          <DialogHeader layout="column">
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldAlert size={16} aria-hidden="true" />
              {t("deletePreview.title")}
            </DialogTitle>
            <DialogDescription>
              {t("deletePreview.description")}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 space-y-3 overflow-auto">
            <PolicyNotice supported={supported} targetError={targetError} />
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] rounded border border-border text-xs">
              <div className="border-r border-b border-border bg-muted/40 px-2 py-1.5 font-medium text-muted-foreground">
                {t("deletePreview.labelTarget")}
              </div>
              <div className="min-w-0 truncate border-b border-border px-2 py-1.5 text-secondary-foreground">
                {target}
              </div>
              <div className="border-r border-border bg-muted/40 px-2 py-1.5 font-medium text-muted-foreground">
                {t("deletePreview.labelCatalogDocs")}
              </div>
              <div className="px-2 py-1.5 text-secondary-foreground">
                {docsCount === undefined
                  ? t("deletePreview.unknownDocs")
                  : docsCount.toLocaleString()}
              </div>
            </div>

            <label className="block space-y-1 text-xs">
              <span className="font-medium text-foreground">
                {t("deletePreview.labelQueryBody")}
              </span>
              <textarea
                className="h-36 w-full resize-none rounded border border-border bg-background p-2 font-mono text-xs leading-5 outline-none focus:border-ring focus:ring-2 focus:ring-ring/30"
                value={bodyText}
                spellCheck={false}
                onChange={(event) => onBodyChange(event.target.value)}
              />
            </label>

            <PlanFeedback state={planState} />
            {planState.status === "loaded" ? (
              <ExecuteSection
                count={planCount}
                execState={execState}
                disabled={execState.status === "running"}
                onDelete={requestExecute}
              />
            ) : null}
          </div>

          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">
                {t("deletePreview.closeButton")}
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canPlan}
              onClick={handlePlan}
            >
              {planState.status === "loading" ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <FileSearch aria-hidden="true" />
              )}
              {t("deletePreview.generateButton")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDestructiveDialog
        open={confirmReason !== null}
        reason={confirmReason ?? ""}
        sqlPreview={t("deletePreview.confirmPreview", {
          target,
          count: planCount ?? 0,
        })}
        environment={confirmEnvironment}
        connectionId={connectionId}
        statements={[
          t("deletePreview.confirmPreview", { target, count: planCount ?? 0 }),
        ]}
        paradigm="search"
        connectionLabel={connectionLabel}
        onConfirm={() => void runExecute(true)}
        onCancel={() => setConfirmReason(null)}
      />
    </>
  );
}

function ExecuteSection({
  count,
  execState,
  disabled,
  onDelete,
}: {
  count: number | undefined;
  execState: ExecState;
  disabled: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation("search");
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={disabled}
        onClick={onDelete}
      >
        {execState.status === "running" ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <Trash2 aria-hidden="true" />
        )}
        {count === undefined
          ? t("deletePreview.deleteButtonUnknown")
          : t("deletePreview.deleteButton", { count })}
      </Button>
      <ExecuteFeedback state={execState} />
    </div>
  );
}

function ExecuteFeedback({ state }: { state: ExecState }) {
  const { t } = useTranslation("search");
  if (state.status === "idle") return null;
  if (state.status === "running") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="animate-spin" size={14} aria-hidden="true" />
        {t("deletePreview.executing")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="space-y-1 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        <p className="font-medium">{state.error.label}</p>
        <DriverErrorHint hint={state.error.hint ?? null} showTitle={false} />
        <p>{state.error.detail}</p>
      </div>
    );
  }

  const { result } = state;
  const partial =
    result.deleted < result.total ||
    result.failures.length > 0 ||
    result.versionConflicts > 0;
  return (
    <section
      aria-label={t("deletePreview.resultSectionAria")}
      className={`space-y-1 rounded border px-3 py-2 text-xs ${
        partial
          ? "border-warning/40 bg-warning/10 text-warning"
          : "border-border text-secondary-foreground"
      }`}
    >
      <p className="font-medium">
        {t("deletePreview.resultDeleted", {
          deleted: result.deleted,
          total: result.total,
        })}
      </p>
      {result.versionConflicts > 0 ? (
        <p>
          {t("deletePreview.resultConflicts", {
            count: result.versionConflicts,
          })}
        </p>
      ) : null}
      {result.failures.length > 0 ? (
        <p role="alert">
          {t("deletePreview.resultFailures", { count: result.failures.length })}
        </p>
      ) : null}
    </section>
  );
}

function PolicyNotice({
  supported,
  targetError,
}: {
  supported: boolean;
  targetError: string | null;
}) {
  const { t } = useTranslation("search");
  const message = !supported
    ? t("deletePreview.policyUnsupported")
    : targetError
      ? targetError
      : t("deletePreview.policyLive");
  const tone = supported && !targetError ? "text-warning" : "text-destructive";
  return (
    <div
      role={supported && !targetError ? "status" : "alert"}
      className={`rounded border border-warning/40 bg-warning/10 px-3 py-2 text-xs ${tone}`}
    >
      <div className="flex items-center gap-2 font-medium">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>{message}</span>
      </div>
    </div>
  );
}

function PlanFeedback({ state }: { state: PlanState }) {
  const { t } = useTranslation("search");
  if (state.status === "idle") {
    return (
      <div className="rounded border border-border px-3 py-2 text-xs text-muted-foreground">
        {t("deletePreview.planOutputIdle")}
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 className="animate-spin" size={14} aria-hidden="true" />
        {t("deletePreview.planLoading")}
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="space-y-1 rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        <p className="font-medium">{state.error.label}</p>
        <DriverErrorHint hint={state.error.hint ?? null} showTitle={false} />
        <p>{state.error.detail}</p>
      </div>
    );
  }

  const { plan } = state;
  return (
    <section
      aria-label={t("deletePreview.planSectionAria")}
      className="space-y-2 rounded border border-border p-3 text-xs"
    >
      <div className="grid grid-cols-[10rem_minmax(0,1fr)] gap-y-1">
        <span className="font-medium text-muted-foreground">
          {t("deletePreview.planLabelOperation")}
        </span>
        <span>{plan.operation}</span>
        <span className="font-medium text-muted-foreground">
          {t("deletePreview.planLabelTarget")}
        </span>
        <span className="truncate">{plan.target}</span>
        <span className="font-medium text-muted-foreground">
          {t("deletePreview.planLabelEstimatedDocs")}
        </span>
        <span>
          {plan.estimatedDocumentCount?.toLocaleString() ??
            t("deletePreview.unknownDocs")}
        </span>
        <span className="font-medium text-muted-foreground">
          {t("deletePreview.planLabelExecution")}
        </span>
        <span>{t("deletePreview.planExecutionLive")}</span>
      </div>
      {plan.warnings.length > 0 ? (
        <ul className="list-disc space-y-1 pl-5 text-warning">
          {plan.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
