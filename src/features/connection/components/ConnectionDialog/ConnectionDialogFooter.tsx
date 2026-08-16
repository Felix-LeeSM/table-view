import { Button } from "@components/ui/button";
import {
  DialogFeedback,
  type DialogFeedbackState,
} from "@components/ui/dialog";
import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plug,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CONNECTION_ERROR_ID } from "../forms/fieldValidation";

/** id of the test-result region the details toggle controls (#2437). */
export const TEST_FEEDBACK_ID = "connection-test-feedback";

export interface ConnectionDialogFooterProps {
  feedbackState: DialogFeedbackState;
  feedbackMessage: string | undefined;
  error: string | null;
  testing: boolean;
  saving: boolean;
  isEditing: boolean;
  onTest: () => void;
  onCancel: () => void;
  onSave: () => void;
}

/**
 * Sprint 213 — presentational footer of `ConnectionDialog`.
 *
 *   - `<DialogFeedback slotName="test-feedback" />` (sprint-95 layer-1
 *     migration, sprint-92 `data-slot` selector contract preserved).
 *   - `error` save-error region (`role="alert"`, sprint-178 sanitised).
 *   - Footer with Test Connection (left) + Cancel/Save (right) — the
 *     dialog-level escape-hatch split documented at the top of
 *     `ConnectionDialog.tsx`.
 *
 * Issue #2437 — the Test Connection button *is* the result: its icon and
 * colour carry idle / pending / success / failure, and the feedback region
 * below is `sr-only` until the user opens the details disclosure beside the
 * button. The only state this component owns is that disclosure; every
 * decision about *what* to show still comes from props.
 */
export default function ConnectionDialogFooter({
  feedbackState,
  feedbackMessage,
  error,
  testing,
  saving,
  isEditing,
  onTest,
  onCancel,
  onSave,
}: ConnectionDialogFooterProps) {
  const { t } = useTranslation("featuresConnection");
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Only success/error carry a message worth reading; idle has none and
  // pending says nothing the spinner doesn't already.
  const hasDetails = feedbackMessage !== undefined;
  return (
    <>
      {/* Test result — pinned outside the scroll container so it is always
          reachable regardless of scroll position or Advanced Settings being
          open.

          Sprint-95 Layer-1 migration: this slot is rendered by the base
          `<DialogFeedback>` primitive. The `slotName` override keeps the
          sprint-92 `data-slot="test-feedback"` selector contract intact so
          `expectNodeStable` continues to track the same DOM node across
          state transitions.

          #2437: `sr-only` while collapsed. That keeps the node mounted with
          its `role="status"` / `role="alert"` / `aria-live` semantics — a
          screen reader hears the full sanitised message as soon as it
          arrives, with or without the disclosure — while the empty band it
          used to reserve before any test costs nothing. Removing the region
          outright would have been an accessibility regression; hiding it
          with `hidden`/`display:none` would have been the same regression
          in a quieter form. */}
      <DialogFeedback
        id={TEST_FEEDBACK_ID}
        slotName="test-feedback"
        state={feedbackState}
        message={feedbackMessage}
        loadingText={t("footer.testingText")}
        className={detailsOpen ? "border-t border-border px-4 py-3" : "sr-only"}
      />
      {error && (
        <div
          id={CONNECTION_ERROR_ID}
          role="alert"
          className="border-t border-border bg-destructive/10 px-4 py-3 text-sm text-destructive duration-200 animate-in fade-in slide-in-from-top-1"
        >
          {error}
        </div>
      )}

      {/* Footer — Issue #1135: explicit `type="button"` so none of these
          trigger the surrounding <form>'s submit; Save keeps its onClick. */}
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
        <div className="flex items-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={testing}
            className={
              feedbackState === "success"
                ? "text-success"
                : feedbackState === "error"
                  ? "text-destructive"
                  : undefined
            }
          >
            {/* #2437 — the status is the icon, not colour alone: four
                distinct glyphs so it survives a monochrome or
                colour-blind read (WCAG 1.4.1). */}
            {feedbackState === "loading" ? (
              <Loader2 className="animate-spin size-3.5" />
            ) : feedbackState === "success" ? (
              <CheckCircle />
            ) : feedbackState === "error" ? (
              <AlertCircle />
            ) : (
              <Plug />
            )}
            {t("footer.testConnection")}
          </Button>
          {hasDetails && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              aria-controls={TEST_FEEDBACK_ID}
              /* Name stays constant across both states; `aria-expanded`
                 carries open/closed, per the disclosure pattern. */
              aria-label={t("footer.testDetails")}
            >
              {detailsOpen ? <ChevronUp /> : <ChevronDown />}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("footer.cancel")}
          </Button>
          <Button type="button" size="sm" onClick={onSave} disabled={saving}>
            {saving
              ? t("footer.saving")
              : isEditing
                ? t("footer.update")
                : t("footer.save")}
          </Button>
        </div>
      </div>
    </>
  );
}
