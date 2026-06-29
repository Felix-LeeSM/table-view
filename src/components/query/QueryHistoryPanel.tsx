/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-02 + AC-372-06 + AC-372-08).
 *
 * Per-tab query history panel — `{connectionId, tabId}` filter 로
 * `list_history` IPC 를 호출하고 cursor pagination + event-driven
 * refetch 를 처리한다. 모든 row 는 `sqlRedacted` 만 표시 (redact-only
 * display invariant); 원문 sql 은 row 클릭 시 열리는 detail modal
 * 에서만 노출된다 (sprint-371 backend 의 단일 escape hatch).
 *
 * Invariants:
 *   - mount 마다 `list_history({connectionId, tabId})` 1회.
 *   - cursor pagination 중 create event → refetch 0 + "New entry" 배지.
 *   - clear event → rows 비움 + cursor reset.
 *   - 원문 sql 0 표시 — 본 panel 내 어디에도 detail modal 외에서 sql 안 노출.
 */

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, Clock, RefreshCw } from "lucide-react";
import { Button } from "@components/ui/button";
import QuerySyntax from "@components/shared/QuerySyntax";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";
import { useQueryHistory } from "@hooks/useQueryHistory";
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
            {rows.map((row) => (
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

          {hasMore && (
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

          {!hasMore && rows.length > 0 && (
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
