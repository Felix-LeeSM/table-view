/**
 * Toggle-driven dock panel that surfaces the user's recent query history
 * sourced from the backend `list_history` IPC (sprint-372 conversion —
 * was previously reading `useQueryHistoryStore.entries`).
 *
 * Sprint 372 (Phase 5 F.5) — backend single source of truth.
 *   - `useQueryHistory` hook owns the IPC + cursor pagination + event
 *     refetch wiring (`history.create` / `history.clear`).
 *   - List response carries `sqlRedacted` only; the original SQL never
 *     surfaces in this panel. Detail inspection opens
 *     `QueryHistoryDetailModal` which fires `get_history_detail` on
 *     mount (the only escape hatch from the redact-only invariant).
 *   - The legacy `entries` reads (and the embedded ConfirmDialog clear
 *     path) move to `ClearHistoryButton` for the IPC-driven clear
 *     workflow.
 */

import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import QuerySyntax from "@components/shared/QuerySyntax";
import { useQueryHistory } from "@hooks/useQueryHistory";
import QueryHistoryDetailModal from "./QueryHistoryDetailModal";
import ClearHistoryButton from "@components/settings/ClearHistoryButton";

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
  const [detailId, setDetailId] = useState<number | null>(null);

  // No tab filter — QueryLog is the global dock view across all
  // connections. The hook still keys off a single `list_history` IPC
  // and uses cursor pagination via Load more.
  const { rows, loading, hasMore, newEntryAvailable, loadMore, refresh } =
    useQueryHistory({ enabled: isVisible });

  useEffect(() => {
    const handler = () => {
      setIsVisible((prev) => !prev);
    };
    window.addEventListener("toggle-query-log", handler);
    return () => window.removeEventListener("toggle-query-log", handler);
  }, []);

  if (!isVisible) return null;

  // Backend already returns rows in DESC executedAt order; the search
  // filter only narrows by the redacted text on the client. Switching
  // to a backend search field is a sprint-373+ refinement.
  const filtered = rows.filter((row) =>
    row.sqlRedacted.toLowerCase().includes(search.toLowerCase()),
  );

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
        {newEntryAvailable && (
          <Button
            variant="ghost"
            size="xs"
            className="text-primary"
            onClick={() => {
              void refresh();
            }}
            data-testid="query-log-new-entry"
          >
            New entry — refresh
          </Button>
        )}
        <ClearHistoryButton
          label="Clear"
          className="gap-1 bg-muted text-muted-foreground hover:text-foreground"
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => setIsVisible(false)}
          aria-label="Close query log"
        >
          <X size={14} />
        </Button>
      </div>

      {/* Entries */}
      <div className="max-h-scroll-md overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {rows.length === 0
              ? "No queries executed yet"
              : "No matching queries"}
          </div>
        ) : (
          filtered.map((row) => (
            <Button
              key={row.id}
              variant="ghost"
              size="xs"
              className="w-full justify-start gap-2 px-3 py-1 text-left font-normal rounded-none h-auto"
              onClick={() => setDetailId(row.id)}
              data-testid={`query-log-row-${row.id}`}
            >
              {/* Cancelled queries paint a muted dot, not destructive
                  red, so a self-abort is visually distinct from a real
                  error. */}
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  row.status === "success"
                    ? "bg-success"
                    : row.status === "cancelled"
                      ? "bg-muted-foreground"
                      : "bg-destructive"
                }`}
                title={row.status}
                data-status={row.status}
              />
              {/* Truncate first (preserves the 80-char invariant), then
                  route through the paradigm dispatcher so Mongo entries
                  surface MQL operator coloring and RDB entries keep SQL
                  keyword treatment. The list IPC sends only
                  `sqlRedacted` — original SQL never leaves the detail
                  modal. */}
              <QuerySyntax
                className="flex-1 truncate text-foreground"
                sql={truncateSql(row.sqlRedacted, 80)}
                paradigm={row.paradigm}
              />
              {/* Timestamp */}
              <span className="shrink-0 text-muted-foreground">
                {formatRelativeTime(row.executedAt)}
              </span>
              {/* Duration badge */}
              <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                {row.durationMs}ms
              </span>
            </Button>
          ))
        )}
        {hasMore && (
          <div className="flex items-center justify-center px-3 py-1.5">
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                void loadMore();
              }}
              disabled={loading}
              data-testid="query-log-load-more"
            >
              {loading ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {detailId !== null && (
        <QueryHistoryDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
