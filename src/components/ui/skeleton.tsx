import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui canonical `Skeleton` primitive — a low-contrast `animate-pulse`
 * placeholder block that matches the rest of the app's design tokens
 * (`bg-muted`, `rounded-md`). Used by Sprint 270 to show app chrome during
 * the pre-hydrate IPC round-trip that populates `connections`, instead of a
 * blank window. Accepts all standard `<div>` attributes so callers can layer
 * width / height utilities via `className`.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
