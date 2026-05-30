/**
 * 사프린트-373 (2026-05-17) — Sprint 5 phase. `useQueryHistoryStore.globalLog`
 * + `clearGlobalLog` + `copyEntry` 의 in-memory mirror 가 retire 됨에 따라
 * 본 컴포넌트는 sprint-372 `useQueryHistory` hook 기반 backend list IPC
 * 로 전환. 외부 API (`visible` / `onClose` props) 는 byte-equivalent —
 * MainArea + WorkspaceToolbar 의 mount 경로는 동결.
 *
 * 동작 변경 요약:
 *   - rows source: `globalLog` (in-memory) → `useQueryHistory({}).rows`.
 *   - SQL preview: `sql` 원문 → `sqlRedacted` only. detail dialog 진입은
 *     sprint-372 의 `QueryHistoryDetailModal` 이 책임.
 *   - search: client-side 필터 (`sqlRedacted` substring) 그대로 — backend
 *     검색 wire 는 sprint-374+ 의 future ADR.
 *   - clear: `ClearHistoryButton` (sprint-372) 가 IPC + emit 책임.
 *   - copy: sprint-373 retire — original SQL 은 detail modal 안에서만
 *     redact-only invariant 의 단일 escape hatch 로 노출. (사용자가 detail
 *     dialog 안에서 복사하는 경로는 sprint-376 / UI audit 의 followup.)
 *   - connection filter: 본 sprint 에서는 backend connection scope 가 sprint-372
 *     의 `useQueryHistory({ connectionId })` 인자로 흘러갈 수 있으나, panel
 *     이 "global" 이므로 모든 connection 의 rows 를 보여주는 게 더 자연스러움.
 *     기존 dropdown 의 UX 가 필요해지면 sprint-374 ADR 에서 처리.
 */

import { useEffect, useState } from "react";
import { Search, X, CheckCircle2, XCircle, CircleSlash } from "lucide-react";
import { useQueryHistory } from "@hooks/useQueryHistory";
import { Button } from "@components/ui/button";
import { Input } from "@components/ui/input";
import QuerySyntax from "@components/shared/QuerySyntax";
import QueryHistorySourceBadge from "@components/shared/QueryHistorySourceBadge";
import type { QueryHistorySource } from "@stores/queryHistoryStore";
import ClearHistoryButton from "@components/settings/ClearHistoryButton";
import QueryHistoryDetailModal from "./QueryHistoryDetailModal";
import { cn } from "@lib/utils";

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

interface GlobalQueryLogPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function GlobalQueryLogPanel({
  visible,
  onClose,
}: GlobalQueryLogPanelProps) {
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
      className="flex flex-col border-t border-border bg-secondary"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-foreground">Query Log</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-medium text-muted-foreground">
          {rows.length}
        </span>
        <div className="flex flex-1 items-center gap-1.5">
          <Search size={12} className="shrink-0 text-muted-foreground" />
          <Input
            type="text"
            data-testid="global-log-search"
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
            data-testid="global-log-new-entry"
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
          onClick={onClose}
          aria-label="Close query log"
        >
          <X size={14} />
        </Button>
      </div>

      {/* Entries */}
      <div className="max-h-scroll-lg overflow-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {rows.length === 0
              ? "No queries executed yet"
              : "No matching queries"}
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
                  {row.paradigm === "document" ? "MQL" : "SQL"}
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
