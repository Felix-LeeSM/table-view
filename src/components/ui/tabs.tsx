import * as React from "react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

function Tabs(props: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root data-slot="tabs" {...props} />;
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn("flex items-center", className)}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors select-none",
        "border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-foreground",
        "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent(
  props: React.ComponentProps<typeof TabsPrimitive.Content>,
) {
  return <TabsPrimitive.Content data-slot="tabs-content" {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
