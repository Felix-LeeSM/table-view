/**
 * `useQueryHistoryStore.globalLog` + `clearGlobalLog` + `copyEntry` retired
 * their in-memory mirror, so this component runs off the backend list IPC
 * behind the `useQueryHistory` hook. The external API (`visible` / `onClose`
 * props) is byte-equivalent — the MainArea + WorkspaceToolbar mount paths
 * stay frozen.
 *
 * Behaviour changes:
 *   - rows source: `globalLog` (in-memory) →
 *     `useQueryHistory({ enabled: visible }).rows`.
 *   - SQL preview: raw `sql` → `sqlRedacted` only. `QueryHistoryDetailModal`
 *     owns entry into the detail dialog.
 *   - search: still a client-side filter (`sqlRedacted` substring) — a
 *     backend search wire is left to a future ADR.
 *   - clear: `ClearHistoryButton` owns the IPC + emit.
 *   - copy: retired — the original SQL is exposed only inside the detail
 *     modal, as the single escape hatch from the redact-only invariant.
 *     (A copy path for the user inside the detail dialog is a UI-audit
 *     follow-up.)
 *   - connection filter: the backend connection scope could flow through the
 *     `useQueryHistory({ connectionId })` argument, but since the panel is
 *     "global" it is more natural to show rows from every connection. If the
 *     UX of the old dropdown is needed, a later ADR handles it.
 */

import ClearHistoryButton from "@components/settings/ClearHistoryButton";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";
import QuerySyntax from "@components/shared/QuerySyntax";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import { useQueryHistory } from "@hooks/useQueryHistory";
import { cn } from "@lib/utils";
import type { QueryHistorySource } from "@stores/queryHistoryStore";
import { toQueryLanguageLabel } from "@stores/workspaceStore/queryMode";
import { CheckCircle2, CircleSlash, Search, X, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import QueryHistoryDetailModal from "./QueryHistoryDetailModal";
import { formatRelativeTime, truncateSql } from "./queryLogFormat";

interface GlobalQueryLogPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function GlobalQueryLogPanel({
  visible,
  onClose,
}: GlobalQueryLogPanelProps) {
  const { t } = useTranslation("query");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<number | null>(null);
  const { rows, loading, hasMore, newEntryAvailable, loadMore, refresh } =
    useQueryHistory({ enabled: visible });

  // Reset client-side filter when panel closes.
  useEffect(() => {
    if (!visible) {
      setSearch("");
      setDetailId(null);
    }
  }, [visible]);

  if (!visible) return null;

  // Client-side substring filter against `sqlRedacted` — backend rows
  // already in DESC executedAt order.
  const filtered = rows.filter((row) =>
    row.sqlRedacted.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div
      data-testid="global-query-log-panel"
      className="flex h-full flex-col border-t border-border bg-secondary"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-foreground">
          {t("queryLog.title")}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
          {rows.length}
        </span>
        <div className="flex flex-1 items-center gap-1.5">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <Input
            type="text"
            data-testid="global-log-search"
            className="h-5 flex-1 border-0 bg-transparent text-xs shadow-none text-foreground placeholder:text-muted-foreground focus-visible:ring-0"
            placeholder={t("queryLog.searchPlaceholder")}
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
            data-testid="global-log-new-entry"
          >
            {t("queryLog.newEntry")}
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
          onClick={onClose}
          aria-label={t("queryLog.closeAria")}
        >
          <X size={14} />
        </Button>
      </div>

      {/* Entries — the dock (#2450) hands this panel a fixed 300px tabpanel,
          so the height clamp lives on the dock and the list scrolls inside
          the space left under the header. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {rows.length === 0
              ? t("queryLog.noQueriesYet")
              : t("queryLog.noMatchingQueries")}
          </div>
        ) : (
          filtered.map((row) => (
            <div
              key={row.id}
              role="button"
              tabIndex={0}
              data-testid={`global-log-entry-${row.id}`}
              className={cn(
                "flex flex-col px-3 py-1 text-xs hover:bg-muted cursor-pointer",
                row.status === "error" && "bg-destructive/10",
                row.status === "cancelled" && "bg-muted/40",
              )}
              onClick={() => setDetailId(row.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDetailId(row.id);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0"
                  title={row.status}
                  data-status={row.status}
                >
                  {row.status === "success" ? (
                    <CheckCircle2 size={12} className="text-success" />
                  ) : row.status === "cancelled" ? (
                    <CircleSlash size={12} className="text-muted-foreground" />
                  ) : (
                    <XCircle size={12} className="text-destructive" />
                  )}
                </span>
                <QuerySyntax
                  className="flex-1 truncate text-foreground"
                  sql={truncateSql(row.sqlRedacted, 80)}
                  paradigm={row.paradigm}
                />
                <span className="shrink-0 text-muted-foreground">
                  {formatRelativeTime(row.executedAt)}
                </span>
                <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-muted-foreground">
                  {row.durationMs}ms
                </span>
                <span
                  className="shrink-0 rounded bg-secondary px-2 py-0.5 font-mono text-secondary-foreground"
                  data-paradigm={row.paradigm}
                >
                  {toQueryLanguageLabel(row.paradigm)}
                </span>
                {row.paradigm === "document" && row.queryMode && (
                  <span
                    className="shrink-0 rounded bg-secondary px-2 py-0.5 text-secondary-foreground"
                    data-query-mode={row.queryMode}
                  >
                    {row.queryMode}
                  </span>
                )}
                <QueryHistorySourceBadge
                  source={row.source as QueryHistorySource}
                  sourceLabel={row.collection}
                />
              </div>
            </div>
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
              data-testid="global-log-load-more"
            >
              {loading ? t("queryLog.loading") : t("queryLog.loadMore")}
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
