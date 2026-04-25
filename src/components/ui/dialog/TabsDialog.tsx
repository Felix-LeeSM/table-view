import { type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type DialogTone,
} from "@components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@components/ui/tabs";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Sprint-96 Layer 2 — `TabsDialog` preset
//
// Renders a title + a `<Tabs>` group inside a Layer-1 `<DialogContent>`.
// The preset owns the standard list+trigger boilerplate; callers only pass
// the `tabs` array (each entry has its own `label`, optional `triggerNode`
// for icons, and a `content` ReactNode). Optional `controlled` props let
// the caller drive the active tab from outside (e.g. `initialTab="import"`
// in `ImportExportDialog`).
//
// Layer rules:
//   - Uses Layer-1 `<Dialog*>` + the existing `<Tabs>` primitive only.
//   - Does not wrap or re-style the tab triggers; callers can pass a
//     `triggerClassName` if they want the existing toggle-style look.
// ---------------------------------------------------------------------------

export interface TabsDialogTab {
  value: string;
  label: ReactNode;
  /** Replaces the default `<TabsTrigger>` text — useful for icon + label. */
  triggerNode?: ReactNode;
  content: ReactNode;
}

export interface TabsDialogProps {
  title: ReactNode;
  description?: ReactNode;
  tabs: TabsDialogTab[];
  /** Initial value when uncontrolled. */
  defaultTab?: string;
  /** Controlled current tab. When provided, `onTabChange` should be too. */
  value?: string;
  onTabChange?: (value: string) => void;
  onClose: () => void;
  /** Forwarded tone for the content border token. */
  tone?: DialogTone;
  /** Forwarded `className` for `DialogContent`. */
  className?: string;
  /** Render tabs strip with a bottom border (default true). */
  bordered?: boolean;
  /** Override the trigger className for custom skinning. */
  triggerClassName?: string;
  /** Override the list className. */
  listClassName?: string;
}

export default function TabsDialog({
  title,
  description,
  tabs,
  defaultTab,
  value,
  onTabChange,
  onClose,
  tone = "default",
  className,
  bordered = true,
  triggerClassName,
  listClassName,
}: TabsDialogProps) {
  const initial = defaultTab ?? tabs[0]?.value;

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className={cn(className)} tone={tone}>
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-xs text-muted-foreground">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <Tabs
          defaultValue={value === undefined ? initial : undefined}
          value={value}
          onValueChange={onTabChange}
        >
          <TabsList
            className={cn(
              "w-full justify-start gap-0 rounded-none",
              bordered ? "border-b border-border" : null,
              listClassName,
            )}
          >
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className={cn("rounded-none", triggerClassName)}
              >
                {tab.triggerNode ?? tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {tabs.map((tab) => (
            <TabsContent key={tab.value} value={tab.value}>
              {tab.content}
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
