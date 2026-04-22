import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function ToggleGroup({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex rounded-md border border-border bg-muted p-0.5 gap-0.5",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded px-2 py-0.5 text-xs font-medium",
        "text-muted-foreground transition-colors select-none",
        "data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm",
        "hover:text-foreground focus-visible:outline-none",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
