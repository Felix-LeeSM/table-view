/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-03 / AC-372-08).
 *
 * 단일 history row 의 원문 sql 을 보여주는 modal. List 응답에는 원문이
 * 없으므로 modal mount 시 `get_history_detail(id)` IPC 를 발사해야만
 * 원문이 표시된다 (redact-only display invariant — strategy F.5 line 537).
 *
 * 책임:
 *   - mount 시 `getHistoryDetail({ id })` 1회 호출 + loading state.
 *   - 응답 sql 을 `<pre>` 안에 raw 로 표시 (단, sqlRedacted 와 비교 라벨).
 *   - close 시 modal 사라짐.
 *
 * Test:
 *   - `QueryHistoryDetailModal.test.tsx` — IPC 호출 1회, sql display, close.
 */

import { useEffect, useState } from "react";
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
            Query history entry #{id}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Original SQL is fetched on demand from
            <code className="ml-1">get_history_detail</code>; the list view
            never carries it.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <p
            className="py-4 text-sm text-muted-foreground"
            data-testid="query-history-detail-loading"
          >
            Loading…
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
                Original SQL
              </h3>
              <pre
                className="max-h-64 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs text-foreground"
                data-testid="query-history-detail-sql"
              >
                {detail.sql}
              </pre>
            </section>
            <section>
              <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Redacted
              </h3>
              <pre
                className="max-h-32 overflow-auto rounded border border-border bg-muted p-2 font-mono text-xs text-muted-foreground"
                data-testid="query-history-detail-sql-redacted"
              >
                {detail.sqlRedacted}
              </pre>
            </section>
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="query-history-detail-close"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
