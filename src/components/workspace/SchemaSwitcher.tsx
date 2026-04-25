import { ChevronDown, Layers } from "lucide-react";
import { useActiveTab } from "@stores/tabStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip";

/**
 * Sprint 127 — read-only schema display in the workspace toolbar.
 *
 * S130 / S131 will promote this into an active picker (PG schema swap,
 * Mongo collection-namespace swap). Until then we render a disabled
 * trigger that visually matches a dropdown so the future activation
 * does not shift surrounding layout.
 *
 * Label resolution:
 *   - No active tab                → "—"
 *   - Active tab with `schema`     → schema name
 *   - Otherwise                    → "(default)"
 */
export default function SchemaSwitcher() {
  const activeTab = useActiveTab();

  let label: string;
  if (!activeTab) {
    label = "—";
  } else if (activeTab.type === "table" && activeTab.schema) {
    label = activeTab.schema;
  } else if (activeTab.type === "query" && activeTab.collection) {
    // Document-paradigm query tabs scope by collection rather than schema;
    // surfacing it under the "schema" slot keeps the toolbar visually
    // populated for Mongo workflows. S131 introduces a dedicated
    // collection switcher; until then this placeholder is intentional.
    label = activeTab.collection;
  } else {
    label = "(default)";
  }

  const tooltipText = "Switching schemas is coming in sprint 128";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            aria-label="Active schema (read-only)"
            aria-disabled="true"
            data-disabled="true"
            tabIndex={-1}
            title={tooltipText}
            className="inline-flex h-7 min-w-[8rem] cursor-not-allowed items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground opacity-70 select-none"
          >
            <span className="flex items-center gap-2 truncate">
              <Layers
                size={12}
                className="shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span className="truncate">{label}</span>
            </span>
            <ChevronDown
              size={14}
              className="shrink-0 opacity-50"
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{tooltipText}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
