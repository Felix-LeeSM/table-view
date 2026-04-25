import { ChevronDown, Database } from "lucide-react";
import { useActiveTab } from "@stores/tabStore";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@components/ui/tooltip";

/**
 * Sprint 127 — read-only DB display in the workspace toolbar.
 *
 * S128 promotes this to an active picker (PG sub-pool / Mongo `use_db`).
 * Until then we render a disabled trigger styled like a dropdown so the
 * S128 transition does not introduce a layout shift.
 *
 * Resolution rules for the displayed label:
 *   - Document-paradigm query tab → `tab.database`
 *   - RDB-paradigm tabs           → `tab.schema` (PG schema also doubles
 *                                    as the "current database" label here
 *                                    because the connection target is the
 *                                    DB, S128 splits the two).
 *   - No active tab               → "—"
 *   - Active tab but no value     → "(default)"
 */
export default function DbSwitcher() {
  const activeTab = useActiveTab();

  let label: string;
  if (!activeTab) {
    label = "—";
  } else if (activeTab.type === "query" && activeTab.database) {
    label = activeTab.database;
  } else if (activeTab.type === "table" && activeTab.schema) {
    // For RDB connections, the user's "current database" is currently
    // surfaced via the connection target itself; Sprint 128 will replace
    // this with a real `current_database()` lookup. Showing the schema
    // here is a pragmatic placeholder — better than "(default)" which
    // would imply the toolbar has no information.
    label = activeTab.schema;
  } else {
    label = "(default)";
  }

  const tooltipText = "Switching DBs is coming in sprint 128";

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            aria-label="Active database (read-only)"
            aria-disabled="true"
            data-disabled="true"
            tabIndex={-1}
            title={tooltipText}
            className="inline-flex h-7 min-w-[8rem] cursor-not-allowed items-center justify-between gap-2 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground opacity-70 select-none"
          >
            <span className="flex items-center gap-2 truncate">
              <Database
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
