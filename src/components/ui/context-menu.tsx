import * as React from "react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Content>) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        data-slot="context-menu-content"
        className={cn(
          "z-50 min-w-35 rounded-md border border-border bg-popover py-1 shadow-md",
          "animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({
  className,
  danger,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Item> & {
  danger?: boolean;
}) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs outline-none transition-colors",
        "hover:bg-muted focus:bg-muted",
        danger ? "text-destructive" : "text-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function ContextMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.Separator>) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("my-1 border-t border-border", className)}
      {...props}
    />
  );
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
