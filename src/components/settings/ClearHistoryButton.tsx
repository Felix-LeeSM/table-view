/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-04).
 *
 * `clear_history` IPC 를 발사하는 단일 책임 버튼. 응답
 * `{deletedCount: N}` 을 사용자에게 toast 로 surface 한다.
 * VACUUM + history.clear emit 은 backend 책임 (sprint-371).
 *
 * UX:
 *   - 클릭 → confirm dialog → 확인 → IPC. 직접 호출하면 실수 복구 불가.
 *   - 응답 deletedCount 0 이면 informational toast (이미 비어 있음).
 *   - IPC reject 시 error toast.
 *
 * 책임 분리:
 *   - "삭제" 자체는 backend 1 IPC + emit. frontend store retire 는 sprint-373.
 *   - 본 컴포넌트는 settings panel + global query log header 양쪽에서
 *     재사용 가능한 standalone unit.
 */

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@components/ui/button";
import ConfirmDialog from "@components/ui/dialog/ConfirmDialog";
import { clearHistory } from "@lib/tauri/history";
import { toast } from "@lib/runtime/toast";
import { logger } from "@lib/logger";

export interface ClearHistoryButtonProps {
  /** Visible label; defaults to `"Clear history"`. */
  label?: string;
  /** Optional className passthrough so callers can tune size/colour. */
  className?: string;
}

export default function ClearHistoryButton({
  label = "Clear history",
  className,
}: ClearHistoryButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      const resp = await clearHistory();
      const n = resp.deletedCount;
      // 일관된 문구: "N row(s) cleared". 0 row 도 동일 패턴이라
      // assertion 이 간단하다.
      const message =
        n === 1
          ? "1 row cleared from history"
          : `${n} rows cleared from history`;
      toast.success(message);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to clear history: ${msg}`);
      logger.warn("[ClearHistoryButton] clear_history failed", msg);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className={className}
        onClick={() => setConfirming(true)}
        disabled={busy}
        aria-label={label}
        data-testid="clear-history-button"
      >
        <Trash2 size={12} />
        {label}
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Clear query history"
          message="Every recorded query (across all connections) will be permanently deleted. This cannot be undone."
          confirmLabel="Clear all history"
          danger
          loading={busy}
          onConfirm={() => {
            void handleConfirm();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  );
}
