import * as React from "react";
import { XIcon, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

// Sprint-95 Layer 1: tone variants. Default keeps the existing shadcn neutral
// border/background; destructive/warning swap the outer border to the
// corresponding semantic token so confirm-style dialogs read as "danger" or
// "caution" without forcing each call site to hand-roll colour classes.
export type DialogTone = "default" | "destructive" | "warning";

const dialogToneClasses: Record<DialogTone, string> = {
  default: "border-border",
  destructive: "border-destructive",
  warning: "border-warning",
};

function DialogContent({
  className,
  children,
  showCloseButton = true,
  tone = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  tone?: DialogTone;
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-tone={tone}
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          dialogToneClasses[tone],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

// Sprint-95 Layer 1: explicit `layout` prop. `row` (default) keeps sprint-91's
// title + close-on-the-same-row contract. `column` opt-in lets callers stack a
// title above a description (the legacy shadcn header arrangement) without
// rewriting className boilerplate.
export type DialogHeaderLayout = "row" | "column";

const dialogHeaderLayoutClasses: Record<DialogHeaderLayout, string> = {
  row: "flex flex-row items-center justify-between gap-2",
  column: "flex flex-col gap-2 text-left",
};

function DialogHeader({
  className,
  layout = "row",
  ...props
}: React.ComponentProps<"div"> & { layout?: DialogHeaderLayout }) {
  // Sprint 91: row-based default. The header is always title + (optional) close
  // button on the same row, so the X aligns with the title's vertical centre
  // and never wraps below it. `min-w-0` lets long titles flex-shrink so a
  // `truncate` on the title can take effect; sprint-95 introduces the explicit
  // `layout` prop so callers needing a stacked title+description can opt in
  // without overriding className.
  return (
    <div
      data-slot="dialog-header"
      data-layout={layout}
      className={cn(
        dialogHeaderLayoutClasses[layout],
        "min-w-0 text-left",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  // Sprint 91: `min-w-0` lets the title shrink inside a flex-row header so a
  // `truncate` class on a long title actually takes effect (without it, flex
  // children default to min-content sizing).
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("min-w-0 text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Sprint-95 Layer 1: DialogFeedback
//
// Generalises the sprint-92 ConnectionDialog test-feedback pattern: a single,
// always-mounted slot that reserves a minimum height so the dialog doesn't
// jump when content appears, and renders one of four states without ever
// unmounting the outer container.
//
// Stable identity contract:
//   - The outer wrapper is mounted on every render regardless of state.
//   - Only the inner content varies with `state`. This is what the
//     sprint-92 `expectNodeStable` assertion relies on — selecting the
//     wrapper by `[data-slot]` and asserting the same node is returned
//     across state transitions.
//
// Slot-name override:
//   - `slotName` lets callers (e.g. ConnectionDialog) keep a legacy
//     `data-slot="test-feedback"` selector working through the migration.
//     Without this knob, the sprint-92 test would no longer find the slot.
// ---------------------------------------------------------------------------

export type DialogFeedbackState = "idle" | "loading" | "success" | "error";

export interface DialogFeedbackProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children"
> {
  state: DialogFeedbackState;
  message?: string;
  loadingText?: string;
  /**
   * Override the `data-slot` value on the wrapper. Defaults to
   * `"dialog-feedback"`. Used by ConnectionDialog to preserve the
   * sprint-92 `data-slot="test-feedback"` selector contract.
   */
  slotName?: string;
}

function DialogFeedback({
  state,
  message,
  loadingText = "Loading...",
  slotName = "dialog-feedback",
  className,
  ...rest
}: DialogFeedbackProps) {
  return (
    <div
      data-slot={slotName}
      data-state={state}
      className={cn(className)}
      {...rest}
    >
      {state === "idle" ? (
        // Idle slot: empty placeholder block reserving height so the dialog
        // height does not jump between empty and filled states. aria-hidden
        // so screen readers don't announce the empty region.
        <div
          aria-hidden="true"
          className="min-h-[2.25rem]"
          data-testid="dialog-feedback-idle"
        />
      ) : state === "loading" ? (
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-[2.25rem] items-center gap-2 rounded bg-muted/40 px-3 py-2 text-sm text-muted-foreground duration-200 animate-in fade-in"
        >
          <Loader2 className="size-4 animate-spin" />
          <span>{loadingText}</span>
        </div>
      ) : (
        <div
          role="alert"
          aria-live="polite"
          className={cn(
            "flex min-h-[2.25rem] items-center gap-2 rounded px-3 py-2 text-sm duration-200 animate-in fade-in slide-in-from-top-1",
            state === "success"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {state === "success" ? (
            <CheckCircle size={16} />
          ) : (
            <AlertCircle size={16} />
          )}
          <span className="break-words">{message}</span>
        </div>
      )}
    </div>
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFeedback,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
