/**
 * Sprint 373 (Phase 5 F.5) — query history retention select.
 *
 * 작성 2026-05-17. `query_history_retention_days` setting 의 사용자
 * control. 4 옵션:
 *   - `7`       — 7 일 (privacy 중시).
 *   - `30`      — 30 일 (default; AC-373-07).
 *   - `90`      — 90 일 (장기 dump 가 필요한 경우).
 *   - `0`       — 무한 보관 ("forever"; backend `boot_vacuum_old_history`
 *                 가 retention <= 0 에서 no-op).
 *
 * UX:
 *   - Radix `<Select>` — 다른 setting select (sidebar mode, theme picker) 와
 *     동일한 시각 패턴.
 *   - 선택 시 즉시 store mutate + fire-and-forget `persist_setting` IPC.
 *     boot 직후 backend 의 `boot_vacuum_old_history()` 가 본 값을 읽어
 *     30일 + 1초 전 row 를 vacuum (AC-373-05).
 *
 * 위치: HistorySettings 컴포넌트와 paired — sprint-376 UI audit 에서
 * 최종 placement.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  useHistorySettingsStore,
  type HistoryRetentionDays,
} from "@stores/historySettingsStore";

// SelectItem 의 value 가 string 만 받아서 7/30/90/0 을 string 으로 round-trip.
// `0` 은 "forever" 의 sentinel — backend 는 retention_days <= 0 에서 no-op.
const RETENTION_OPTIONS: ReadonlyArray<{
  value: HistoryRetentionDays;
  label: string;
}> = [
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
  { value: 0, label: "Forever (no cleanup)" },
];

function fromString(raw: string): HistoryRetentionDays {
  const parsed = Number(raw);
  if (parsed === 0 || parsed === 7 || parsed === 30 || parsed === 90) {
    return parsed;
  }
  // unknown — fall back to 30 (default). Defensive: option list 외 값이
  // 본 함수에 도달할 수 없지만 type-narrowing 을 위해 명시.
  return 30;
}

export default function HistoryRetentionSelect() {
  const value = useHistorySettingsStore((s) => s.queryHistoryRetentionDays);
  const setValue = useHistorySettingsStore(
    (s) => s.setQueryHistoryRetentionDays,
  );

  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor="history-retention-select"
        className="text-xs font-medium text-foreground"
      >
        Retention
      </label>
      <Select
        value={String(value)}
        onValueChange={(raw) => {
          void setValue(fromString(raw));
        }}
      >
        <SelectTrigger
          id="history-retention-select"
          data-testid="history-retention-select"
          className="h-7 text-xs"
          aria-label="Query history retention period"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RETENTION_OPTIONS.map((opt) => (
            <SelectItem
              key={opt.value}
              value={String(opt.value)}
              data-testid={`history-retention-option-${opt.value}`}
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
