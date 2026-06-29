import { type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFeedback,
  type DialogFeedbackState,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  type DialogTone,
  type DialogHeaderLayout,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// `FormDialog` preset (Layer 2). Wraps the title + body + submit/cancel
// footer pattern — caller only supplies form fields via `children`.
//
// `feedback` surfaces async outcomes (e.g. server validation after submit)
// inside a stable, always-mounted slot. When omitted, the slot is not
// rendered, so simple forms with inline `role="alert"` elements
// (e.g. `GroupDialog`'s name validation) keep their own layout.
// ---------------------------------------------------------------------------

export interface FormDialogFeedback {
  state: DialogFeedbackState;
  message?: string;
  loadingText?: string;
}

export interface FormDialogProps {
  title: ReactNode;
  description?: ReactNode;
  /** Pass-through to the primitive — defaults to `default`. */
  tone?: DialogTone;
  /** Pass-through — `column` stacks title + description; default `row`. */
  headerLayout?: DialogHeaderLayout;
  /** Form body. Caller owns inputs, validation visuals, etc. */
  children: ReactNode;
  /** Footer action: primary submit. */
  onSubmit: () => void;
  /** Footer action: secondary cancel / close. */
  onCancel: () => void;
  submitLabel?: ReactNode;
  cancelLabel?: ReactNode;
  /** Disables both buttons + ignores Esc-driven close. */
  isSubmitting?: boolean;
  /** Independent disable flag for submit (e.g. required-field guard). */
  submitDisabled?: boolean;
  /** Optional async-outcome slot rendered between body and footer. */
  feedback?: FormDialogFeedback;
  /** Width / padding overrides. Forwarded to `DialogContent`. */
  className?: string;
  /** Override `aria-label` of the submit button (defaults to its label). */
  submitAriaLabel?: string;
  /**
   * If true, hides the absolute X button. Mirrors the primitive's prop —
   * preset defaults to `false` (= absolute X is hidden) since the footer
   * already provides Cancel; flip to `true` for forms that want both.
   */
  showCloseButton?: boolean;
}

export default function FormDialog({
  title,
  description,
  tone = "default",
  headerLayout = "column",
  children,
  onSubmit,
  onCancel,
  submitLabel,
  cancelLabel,
  isSubmitting = false,
  submitDisabled = false,
  feedback,
  className,
  submitAriaLabel,
  showCloseButton = false,
}: FormDialogProps) {
  const { t } = useTranslation("ui");
  const resolvedSubmitLabel = submitLabel ?? t("save");
  const resolvedCancelLabel = cancelLabel ?? t("cancel");
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onCancel();
      }}
    >
      <DialogContent
        className={cn(className)}
        showCloseButton={showCloseButton}
        tone={tone}
      >
        <DialogHeader
          // Default `column` matches the stacked title + description shape
          // used by every form dialog today.
          layout={headerLayout}
        >
          <DialogTitle className="text-sm font-semibold text-foreground">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-xs text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <div className="flex flex-col gap-3">{children}</div>

        {feedback ? (
          <DialogFeedback
            state={feedback.state}
            message={feedback.message}
            loadingText={feedback.loadingText}
          />
        ) : null}

        <DialogFooter className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {resolvedCancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "default"}
            size="sm"
            onClick={onSubmit}
            disabled={isSubmitting || submitDisabled}
            aria-label={submitAriaLabel}
          >
            {resolvedSubmitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
