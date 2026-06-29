/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-03 / AC-372-08).
 *
 * 단일 history row 의 원문 sql 을 보여주는 modal. List 응답에는 원문이
 * 없으므로 modal mount 시 `get_history_detail(id)` IPC 를 발사해야만
 * 원문이 표시된다 (redact-only display invariant — strategy F.5 line 537).
 *
 * 책임:
 *   - mount 시 `getHistoryDetail({ id })` 1회 호출 + loading state.
 *   - 응답 sql 을 `<pre>` 안에 표시. file-analytics 는 redacted variant 만 표시.
 *   - close 시 modal 사라짐.
 *
 * Test:
 *   - `QueryHistoryDetailModal.test.tsx` — IPC 호출 1회, sql display, close.
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@components/ui/dialog";
import { Button } from "@components/ui/button";
import {
  getHistoryDetail,
  type HistoryDetailResponse,
} from "@lib/tauri/history";
import { logger } from "@lib/logger";

export interface QueryHistoryDetailModalProps {
  /** Numeric history row id (backend pk). */
  id: number;
  /** Modal close handler — caller un-mounts. */
  onClose: () => void;
}

export default function QueryHistoryDetailModal({
  id,
  onClose,
}: QueryHistoryDetailModalProps) {
  const { t } = useTranslation("query");
  const [detail, setDetail] = useState<HistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const resp = await getHistoryDetail({ id });
        if (!cancelled) {
          setDetail(resp);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg);
          logger.warn("[QueryHistoryDetailModal] fetch failed", msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-w-2xl"
        showCloseButton
        data-testid="query-history-detail-modal"
      >
        <DialogHeader>
          <DialogTitle className="text-sm font-semibold text-foreground">
            {t("historyDetail.title", { id })}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            SQL detail is fetched on demand from
            <code className="ml-1">get_history_detail</code>; the list view
            never carries it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p
            className="py-4 text-sm text-muted-foreground"
            data-testid="query-history-detail-loading"
          >
            {t("historyDetail.loading")}
          </p>
        )}

        {error !== null && !loading && (
          <p
            role="alert"
            className="py-4 text-sm text-destructive"
            data-testid="query-history-detail-error"
          >
            {error}
          </p>
        )}

        {detail !== null && !loading && (
          <div className="space-y-3">
            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {detail.source === "file-analytics"
                  ? t("historyDetail.sectionSql")
                  : t("historyDetail.sectionOriginalSql")}
              </h3>
              <pre
                className="max-h-64 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs text-foreground"
                data-testid="query-history-detail-sql"
              >
                {detail.source === "file-analytics"
                  ? detail.sqlRedacted
                  : detail.sql}
              </pre>
            </section>
            {detail.source !== "file-analytics" && (
              <section>
                <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t("historyDetail.sectionRedacted")}
                </h3>
                <pre
                  className="max-h-32 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs text-muted-foreground"
                  data-testid="query-history-detail-sql-redacted"
                >
                  {detail.sqlRedacted}
                </pre>
              </section>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="query-history-detail-close"
          >
            {t("historyDetail.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
