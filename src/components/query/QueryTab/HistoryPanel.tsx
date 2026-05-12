import { useState } from "react";
import { Button } from "@components/ui/button";
import {
  Clock,
  Trash2,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
} from "lucide-react";
import QuerySyntax from "@components/shared/QuerySyntax";
import type { QueryHistoryEntry } from "@stores/queryHistoryStore";
import type { QueryMode } from "@stores/workspaceStore";
import type { Paradigm } from "@/types/connection";

interface LoadQueryArgs {
  connectionId: string;
  paradigm: Paradigm;
  queryMode: QueryMode;
  database?: string;
  collection?: string;
  sql: string;
}

/**
 * `QueryTab` 의 history panel 컴포넌트.
 *
 * 책임: 최근 쿼리 history 를 collapsible list 로 표시. 각 entry 의
 * QuerySyntax preview + duration badge + Load 버튼. 펼침/접힘 state 는
 * 본 컴포넌트가 보유 — entry 의 lifecycle 과 묶여 tab unmount 시에만
 * 리셋됨 (분해 이전과 동등).
 *
 * Invariants:
 * - Renders nothing when `entries.length === 0`.
 * - Both double-click and the explicit Load button route through the
 *   same `onLoad`, with `paradigm ?? "rdb"` / `queryMode ?? "sql"`
 *   defaults so legacy entries missing those fields still load.
 */

export interface QueryHistoryPanelProps {
  entries: QueryHistoryEntry[];
  onLoad: (args: LoadQueryArgs) => void;
  onClear: () => void;
}

export default function QueryHistoryPanel({
  entries,
  onLoad,
  onClear,
}: QueryHistoryPanelProps) {
  const [expanded, setExpanded] = useState(false);

  if (entries.length === 0) return null;

  return (
    <div className="border-t border-border bg-secondary">
      <Button
        variant="ghost"
        size="xs"
        className="w-full justify-start text-secondary-foreground"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
        <Clock />
        <span>History ({entries.length})</span>
      </Button>
      {expanded && (
        <ul className="max-h-40 overflow-y-auto">
          {entries.map((entry) => {
            const handleLoad = () =>
              onLoad({
                connectionId: entry.connectionId,
                paradigm: entry.paradigm ?? "rdb",
                queryMode: entry.queryMode ?? "sql",
                database: entry.database,
                collection: entry.collection,
                sql: entry.sql,
              });
            return (
              <li
                key={entry.id}
                className="group flex items-center gap-2 border-t border-border px-3 py-1 hover:bg-muted"
                onDoubleClick={handleLoad}
                title="Double-click to load into editor"
              >
                <span
                  className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background ${
                    entry.status === "success" ? "bg-success" : "bg-destructive"
                  }`}
                  title={entry.status}
                />
                <QuerySyntax
                  sql={entry.sql}
                  paradigm={entry.paradigm}
                  queryMode={entry.queryMode}
                  className="min-w-0 flex-1 select-text cursor-text truncate text-xs"
                />
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {entry.duration}ms
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground"
                  onClick={handleLoad}
                  aria-label={`Load query into editor: ${entry.sql}`}
                  title="Load into editor"
                >
                  <CornerDownLeft />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center justify-end border-t border-border px-2 py-0.5">
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground hover:text-destructive"
          onClick={onClear}
          aria-label="Clear history"
        >
          <Trash2 />
          Clear
        </Button>
      </div>
    </div>
  );
}
