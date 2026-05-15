// Sprint 329 (2026-05-15) — Slice DB-Scope.2: Mongo query tab inline DB
// chip. DataGrip-style display chip; actual database switching is owned
// by the sidebar's right-click "New query here" entry-point (Sprint 330).
// See `docs/explorations/mongo-db-scope-patterns.html` for the pattern
// comparison that landed this design.

import { Database, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";

export interface TabDbChipProps {
  /** Mongo database currently bound to the tab. Empty string = chip is hidden. */
  database: string;
}

export default function TabDbChip({ database }: TabDbChipProps) {
  if (database === "") return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Current database: ${database}`}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-foreground hover:bg-accent"
        >
          <Database
            size={12}
            className="shrink-0 text-muted-foreground"
            aria-hidden
          />
          <span className="truncate">{database}</span>
          <ChevronDown size={12} className="shrink-0 opacity-60" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-72 p-3 text-xs">
        <div className="mb-2 flex items-center gap-1.5 font-medium">
          <Database size={12} aria-hidden />
          <span>Database — {database}</span>
        </div>
        <p className="text-muted-foreground">
          To query a different database, right-click a database in the sidebar
          and choose <strong>New query here</strong>.
        </p>
      </PopoverContent>
    </Popover>
  );
}
