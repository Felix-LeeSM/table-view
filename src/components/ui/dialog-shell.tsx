// Sprint 241 — `DialogShell` compound layout for tall, multi-region
// modal forms (CreateTableDialog, future structure editors). Splits a
// `DialogContent` into three regions:
//
//   <DialogShell>
//     <DialogShell.Header>{title bar}</DialogShell.Header>
//     <DialogShell.Body>{scrollable form}</DialogShell.Body>
//     <DialogShell.Footer>{DDL preview, action buttons}</DialogShell.Footer>
//   </DialogShell>
//
// The dialog itself caps at 90 vh and lays out as a 3-row CSS grid:
//
//   grid-template-rows: auto minmax(0,1fr) auto
//
// Header + Footer auto-size to their content; Body takes the remaining
// space and scrolls. `minmax(0,1fr)` is the load-bearing piece — the
// `0` minimum lets the body shrink below its intrinsic content height
// so `overflow-y-auto` actually engages. (CSS grid's default min-content
// floor is what made the prior `flex flex-col + min-h-0 + flex-1`
// version unreliable: with the base `DialogContent`'s lingering `gap-4`
// and grid display, the body sometimes refused to shrink and pushed
// the dialog past 90 vh on its own.)
//
// Why compound:
//   - The 3-region scroll pattern is project-wide useful (any tall
//     form modal will need it). Extracting once keeps every consumer
//     byte-equivalent.
//   - The shadcn `Dialog`, `DialogContent`, `DialogHeader`,
//     `DialogFooter` family stays unmodified — this file only adds
//     a thin layout wrapper on top.
//
// Date: 2026-05-08.

import * as React from "react";
import { DialogContent } from "@components/ui/dialog";
import { cn } from "@/lib/utils";

type DialogContentProps = React.ComponentProps<typeof DialogContent>;

interface DialogShellRootProps extends DialogContentProps {
  /**
   * Override the default `max-h-[90vh]` cap on the dialog itself. Pass
   * a Tailwind utility (e.g. `"max-h-[80vh]"`) to tighten or relax.
   * Most consumers should keep the default.
   */
  maxHeightClassName?: string;
}

function DialogShellRoot({
  className,
  maxHeightClassName = "max-h-[90vh]",
  children,
  ...rest
}: DialogShellRootProps) {
  return (
    <DialogContent
      className={cn(
        // `grid-rows-[auto_minmax(0,1fr)_auto]` defines header /
        // body / footer rows. `gap-0` neutralises the base
        // `DialogContent`'s `gap-4` so border-bound dividers sit
        // flush against header / body / footer. `p-0` strips the
        // base `p-6` so each region controls its own padding.
        "grid w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden bg-secondary p-0",
        maxHeightClassName,
        className,
      )}
      {...rest}
    >
      {children}
    </DialogContent>
  );
}

function DialogShellHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 border-b border-border bg-secondary", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

function DialogShellBody({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // `min-h-0` lets the grid row shrink below its content's
      // intrinsic height so `overflow-y-auto` engages. `h-full`
      // fills the row's allocated 1fr space.
      className={cn(
        "h-full min-h-0 overflow-y-auto bg-secondary px-4 py-3",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

function DialogShellFooter({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 border-t border-border bg-secondary", className)}
      {...rest}
    >
      {children}
    </div>
  );
}

// Compound exports — both as default + named to match shadcn idiom.
const DialogShell = Object.assign(DialogShellRoot, {
  Header: DialogShellHeader,
  Body: DialogShellBody,
  Footer: DialogShellFooter,
});

export {
  DialogShell,
  DialogShellRoot,
  DialogShellHeader,
  DialogShellBody,
  DialogShellFooter,
};
export default DialogShell;
