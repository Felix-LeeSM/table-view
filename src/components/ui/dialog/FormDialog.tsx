import { type ReactNode } from "react";
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
// Sprint-96 Layer 2 — `FormDialog` preset
//
// Wraps the title + body + submit/cancel footer pattern. Owns the
// boilerplate (header layout, footer button order, optional feedback slot)
// so the call-site only supplies the form fields via `children`.
//
// Layer rules:
//   - Uses Layer-1 primitives (`<Dialog*>`, `<DialogFeedback>`) only.
//   - Forwards `tone` / `headerLayout` to the primitives so callers don't
//     hand-roll className overrides.
//
// `feedback` lets the caller surface async outcomes (e.g. server validation
// after submit) inside a stable, always-mounted slot. When omitted the slot
// is not rendered at all — so simple forms with inline `role="alert"`
// elements (like `GroupDialog`'s name validation) keep their own layout.
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
  submitLabel = "Save",
  cancelLabel = "Cancel",
  isSubmitting = false,
  submitDisabled = false,
  feedback,
  className,
  submitAriaLabel,
  showCloseButton = false,
}: FormDialogProps) {
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
          // The default `column` layout matches sprint-95's stacked title +
          // description shape used by every form dialog today.
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
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "destructive" ? "destructive" : "default"}
            size="sm"
            onClick={onSubmit}
            disabled={isSubmitting || submitDisabled}
            aria-label={submitAriaLabel}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
