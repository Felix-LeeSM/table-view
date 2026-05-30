/**
 * Sprint 373 (Phase 5 F.5) — "Disable history" 토글.
 *
 * 작성 2026-05-17. `query_history_enabled` setting 의 사용자 control. ON
 * (default) → 6 source caller 가 `add_history_entry` IPC 를 호출. OFF →
 * IPC 호출 path 가 0 (AC-373-03 의 spy invariant).
 *
 * UX:
 *   - 단일 button 토글 (Power 아이콘) — 클릭 시 즉시 store mutate +
 *     fire-and-forget `persist_setting` IPC. UI 변경이 backend reject 보다
 *     앞서므로 사용자 인식 latency 0.
 *   - aria-pressed 가 truth 동기화 — accessibility test 가 본 attribute 로
 *     사용자 의도 검증.
 *   - 옵션 tooltip (`title=`) 는 사용자가 disable 후 행동 변화를 설명:
 *     "Disable → 향후 쿼리는 기록 안 됨. 기존 row 는 그대로 (clear 별도)."
 *
 * 위치: Settings 영역 (HomePage / launcher 의 설정 surface). 본 sprint
 * 에서는 컴포넌트 정의만 — placement 는 sprint-376 의 UI audit.
 */

import { Power, PowerOff } from "lucide-react";
import { Button } from "@components/ui/button";
import { useHistorySettingsStore } from "@stores/historySettingsStore";

export default function HistorySettings() {
  const enabled = useHistorySettingsStore((s) => s.queryHistoryEnabled);
  const setEnabled = useHistorySettingsStore((s) => s.setQueryHistoryEnabled);

  const Icon = enabled ? Power : PowerOff;
  // sprint-373 — toggle off 가 "disable" 의 의도임을 명확히. enable/disable
  // 의 정관사 라벨이 button 자체에 살아있어 toggle 양 state 의 label 이
  // 사용자에게 분명.
  const label = enabled ? "History recording: On" : "History recording: Off";
  const tooltip = enabled
    ? "Query history is enabled. Click to disable — future queries will not be recorded. Existing rows remain (use Clear to remove)."
    : "Query history is disabled. Click to enable — future queries will be recorded.";

  return (
    <Button
      variant="ghost"
      size="sm"
      type="button"
      aria-label={label}
      aria-pressed={enabled ? "true" : "false"}
      data-testid="history-settings-toggle"
      data-enabled={enabled ? "true" : "false"}
      title={tooltip}
      onClick={() => {
        void setEnabled(!enabled);
      }}
    >
      <Icon
        className={`h-4 w-4 ${enabled ? "text-success" : "text-muted-foreground"}`}
        aria-hidden="true"
      />
      <span className="ml-1 text-xs">{label}</span>
    </Button>
  );
}
