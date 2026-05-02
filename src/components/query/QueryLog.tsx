import { useEffect, useState } from "react";
import { Search, Trash2, X } from "lucide-react";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import ConfirmDialog from "@components/shared/ConfirmDialog";
import QuerySyntax from "@components/shared/QuerySyntax";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";

function truncateSql(sql: string, maxLen: number): string {
  if (sql.length <= maxLen) return sql;
  return sql.slice(0, maxLen) + "...";
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export default function QueryLog() {
  const [isVisible, setIsVisible] = useState(false);
  const [search, setSearch] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const entries = useQueryHistoryStore((s) => s.entries);
  const clearHistory = useQueryHistoryStore((s) => s.clearHistory);

  useEffect(() => {
    const handler = () => {
      setIsVisible((prev) => !prev);
    };
    window.addEventListener("toggle-query-log", handler);
    return () => window.removeEventListener("toggle-query-log", handler);
  }, []);

  if (!isVisible) return null;

  const filtered = entries.filter((e) =>
    e.sql.toLowerCase().includes(search.toLowerCase()),
  );

  const handleEntryClick = (sql: string) => {
    window.dispatchEvent(new CustomEvent("insert-sql", { detail: { sql } }));
  };

  return (
    <div
      data-testid="query-log-panel"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-secondary"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-foreground">Query Log</span>
        <div className="flex flex-1 items-center gap-1.5">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <Input
            type="text"
            className="h-5 flex-1 border-0 bg-transparent text-xs shadow-none text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
            placeholder="Search queries..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="gap-1 bg-muted text-muted-foreground hover:text-foreground"
          onClick={() => setShowClearConfirm(true)}
          aria-label="Clear history"
        >
          <Trash2 size={12} />
          Clear
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setIsVisible(false)}
        >
          <X size={14} />
        </Button>
      </div>

      {/* Entries */}
      <div className="max-h-scroll-md overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {entries.length === 0
              ? "No queries executed yet"
              : "No matching queries"}
          </div>
        ) : (
          filtered.map((entry) => (
            <Button
              key={entry.id}
              variant="ghost"
              size="xs"
              className="w-full justify-start gap-2 px-3 py-1 text-left font-normal rounded-none h-auto"
              onClick={() => handleEntryClick(entry.sql)}
            >
              {/* Status dot — Sprint 180 (AC-180-03) widens the colour
                  branches: cancelled queries paint a calm muted dot
                  rather than the destructive red so the user can tell
                  apart a true error from a self-aborted op at a glance. */}
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  entry.status === "success"
                    ? "bg-success"
                    : entry.status === "cancelled"
                      ? "bg-muted-foreground"
                      : "bg-destructive"
                }`}
                title={entry.status}
                data-status={entry.status}
              />
              {/* SQL text — paradigm-aware syntax highlighting (Sprint 177).
                  Mirrors the consumption pattern in `GlobalQueryLogPanel.tsx`
                  and `QueryTab.tsx`: truncate first (preserves the existing
                  80-char invariant), then route through the paradigm
                  dispatcher so Mongo entries surface MQL operator coloring
                  while RDB entries keep SQL keyword treatment. */}
              <QuerySyntax
                className="flex-1 truncate text-foreground"
                sql={truncateSql(entry.sql, 80)}
                paradigm={entry.paradigm}
                queryMode={entry.queryMode}
              />
              {/* Source badge — Sprint 196 (AC-196-06). raw entries are
                  suppressed inside the badge component. */}
              <QueryHistorySourceBadge source={entry.source} />
              {/* Timestamp */}
              <span className="shrink-0 text-muted-foreground">
                {formatRelativeTime(entry.executedAt)}
              </span>
              {/* Duration badge */}
              <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                {entry.duration}ms
              </span>
            </Button>
          ))
        )}
      </div>

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear Query History"
          message="Are you sure you want to clear all query history? This cannot be undone."
          confirmLabel="Clear All"
          danger
          onConfirm={() => {
            clearHistory();
            setShowClearConfirm(false);
          }}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </div>
  );
}
