/**
 * AC-372-02 + AC-372-06 + AC-372-08.
 *
 * Per-tab query history panel — calls the `list_history` IPC with a
 * `{connectionId, tabId}` filter and handles cursor pagination plus
 * event-driven refetch. Every row shows `sqlRedacted` only (redact-only
 * display invariant); the original sql is exposed only in the detail modal a
 * row click opens (the backend's single escape hatch).
 *
 * Invariants:
 *   - One `list_history({connectionId, tabId})` per mount.
 *   - create event during cursor pagination → no refetch + "New entry" badge.
 *   - clear event → rows emptied + cursor reset.
 *   - Original sql never rendered — nowhere in this panel outside the detail
 *     modal.
 */

import HistoryCollapseToggle from "@components/shared/HistoryCollapseToggle";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";
import QuerySyntax from "@components/shared/QuerySyntax";
import { Button } from "@components/ui/button";
import { useCollapsibleHistory } from "@hooks/useCollapsibleHistory";
import { useQueryHistory } from "@hooks/useQueryHistory";
import { ChevronDown, ChevronRight, Clock, RefreshCw } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import QueryHistoryDetailModal from "./QueryHistoryDetailModal";

export interface QueryHistoryPanelProps {
  connectionId: string;
  tabId: string;
}

export default function QueryHistoryPanel({
  connectionId,
  tabId,
}: QueryHistoryPanelProps) {
  const {
    rows,
    loading,
    error,
    hasMore,
    newEntryAvailable,
    loadMore,
    refresh,
  } = useQueryHistory({ connectionId, tabId });

  const { t } = useTranslation("query");
  const [isExpanded, setIsExpanded] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const bodyId = useId();
  // #1309 — cap the loaded rows to the shared history default; expanding reveals
  // the rest of the current page, `loadMore` still fetches the next page.
  const rowCollapse = useCollapsibleHistory(rows);
  const allRowsShown = rowCollapse.hiddenCount === 0;

  return (
    <div
      data-testid="query-history-panel"
      className="border-t border-border bg-secondary"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <button
          type="button"
          aria-controls={bodyId}
          aria-expanded={isExpanded}
          aria-label={
            isExpanded
              ? t("historyPanel.collapseAria")
              : t("historyPanel.expandAria")
          }
          className="-ml-1 flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left text-xs font-medium text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setIsExpanded((expanded) => !expanded)}
        >
          {isExpanded ? (
            <ChevronDown size={12} className="shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight
              size={12}
              className="shrink-0 text-muted-foreground"
            />
          )}
          <Clock size={12} className="shrink-0 text-muted-foreground" />
          <span className="truncate">{t("historyPanel.tabHistory")}</span>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            data-testid="query-history-panel-count"
          >
            {rows.length}
          </span>
        </button>
        {newEntryAvailable && (
          <Button
            variant="ghost"
            size="xs"
            className="text-primary"
            onClick={() => {
              void refresh();
            }}
            data-testid="query-history-panel-new-entry"
          >
            <RefreshCw size={12} />
            {t("historyPanel.newEntry")}
          </Button>
        )}
      </div>

      {isExpanded && (
        <div id={bodyId} data-testid="query-history-panel-body">
          {error !== null && (
            <p
              role="alert"
              className="px-3 py-2 text-xs text-destructive"
              data-testid="query-history-panel-error"
            >
              {error}
            </p>
          )}

          {!loading && rows.length === 0 && error === null && (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("historyPanel.noQueriesYet")}
            </p>
          )}

          <ul
            className="max-h-40 overflow-y-auto"
            data-testid="query-history-panel-rows"
          >
            {rowCollapse.visible.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-2 border-b border-border px-3 py-1 hover:bg-muted"
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                    row.status === "success"
                      ? "bg-success"
                      : row.status === "cancelled"
                        ? "bg-muted-foreground"
                        : "bg-destructive"
                  }`}
                  title={row.status}
                />
                <QueryHistorySourceBadge
                  source={row.source}
                  sourceLabel={row.collection}
                />
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs"
                  onClick={() => setDetailId(row.id)}
                  aria-label={t("historyPanel.inspectEntryAria", {
                    id: row.id,
                  })}
                  data-testid={`query-history-panel-row-${row.id}`}
                >
                  <QuerySyntax
                    sql={row.sqlRedacted}
                    paradigm={row.paradigm}
                    className="truncate text-foreground"
                  />
                </button>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                  {row.durationMs}ms
                </span>
              </li>
            ))}
          </ul>

          {rowCollapse.canToggle && (
            <div className="flex items-center justify-center px-3 py-1.5">
              <HistoryCollapseToggle
                expanded={rowCollapse.expanded}
                hiddenCount={rowCollapse.hiddenCount}
                onToggle={rowCollapse.toggle}
                data-testid="query-history-panel-collapse"
              />
            </div>
          )}

          {allRowsShown && hasMore && (
            <div className="flex items-center justify-center px-3 py-1.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  void loadMore();
                }}
                disabled={loading}
                data-testid="query-history-panel-load-more"
              >
                {loading
                  ? t("historyPanel.loading")
                  : t("historyPanel.loadMore")}
              </Button>
            </div>
          )}

          {allRowsShown && !hasMore && rows.length > 0 && (
            <p
              className="px-3 py-1.5 text-center text-xs text-muted-foreground"
              data-testid="query-history-panel-end"
            >
              {t("historyPanel.endOfHistory")}
            </p>
          )}
        </div>
      )}

      {detailId !== null && (
        <QueryHistoryDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
