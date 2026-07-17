/**
 * 작성 2026-07-17 (#1566) — "Reveal logs" 버튼.
 *
 * `open_log_dir` IPC 를 발사해 진단 로그 폴더(#1599 file sink)를 OS 파일
 * 탐색기로 연다. 비개발자 사용자가 플랫폼 data dir 경로를 찾지 않고도 로그를
 * 버그 리포트에 첨부할 수 있게 하는 support affordance.
 *
 * UX: 클릭 → IPC. 성공은 OS 탐색기가 열리는 것으로 자명하므로 toast 없음.
 * 실패(파일 탐색기 부재 / IO)는 silent 하지 않게 error toast 로 surface.
 *
 * ClearHistoryButton 의 standalone settings-button 패턴을 재사용 —
 * launcher footer 등 어느 settings surface 에서도 재사용 가능.
 */

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FolderOpen } from "lucide-react";
import { Button } from "@components/ui/button";
import { openLogDir } from "@lib/tauri/diagnostics";
import { toast } from "@lib/runtime/toast";
import { logger } from "@lib/logger";

export interface RevealLogsButtonProps {
  /** Optional className passthrough so callers can tune size/layout. */
  className?: string;
}

export default function RevealLogsButton({ className }: RevealLogsButtonProps) {
  const { t } = useTranslation("settings");
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await openLogDir();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(t("revealLogs.errorPrefix", { msg }));
      logger.warn("[RevealLogsButton] open_log_dir failed", msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="xs"
      className={className}
      onClick={() => void handleClick()}
      disabled={busy}
      aria-label={t("revealLogs.label")}
      data-testid="reveal-logs-button"
    >
      <FolderOpen size={12} />
      {t("revealLogs.label")}
    </Button>
  );
}
