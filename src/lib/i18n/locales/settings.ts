/**
 * `settings` 네임스페이스 — settings surface 공용 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  clearHistory: {
    label: "Clear history",
    rowCleared_one: "1 row cleared from history",
    rowCleared_other: "{{count}} rows cleared from history",
    errorPrefix: "Failed to clear history: {{msg}}",
    dialogTitle: "Clear query history",
    dialogMessage:
      "Every recorded query (across all connections) will be permanently deleted. This cannot be undone.",
    dialogConfirm: "Clear all history",
  },
  historySettings: {
    labelOn: "History recording: On",
    labelOff: "History recording: Off",
    tooltipOn:
      "Query history is enabled. Click to disable — future queries will not be recorded. Existing rows remain (use Clear to remove).",
    tooltipOff:
      "Query history is disabled. Click to enable — future queries will be recorded.",
  },
  rowCap: {
    ariaLabel: "Query row cap",
    tooltip: "Query row cap: {{count}} rows",
    label: "Maximum rows per query",
    help: "Results larger than this are truncated at fetch time to bound memory. Add a LIMIT clause for precise control.",
    reset: "Reset",
    range: "Allowed range: {{min}}–{{max}}",
  },
  revealLogs: {
    label: "Reveal logs",
    errorPrefix: "Failed to open logs folder: {{msg}}",
  },
} as const;

export const ko = {
  clearHistory: {
    label: "히스토리 지우기",
    rowCleared_one: "히스토리에서 1행 삭제됨",
    rowCleared_other: "히스토리에서 {{count}}행 삭제됨",
    errorPrefix: "히스토리 삭제 실패: {{msg}}",
    dialogTitle: "쿼리 히스토리 지우기",
    dialogMessage:
      "모든 연결의 기록된 쿼리가 영구 삭제됩니다. 이 작업은 취소할 수 없습니다.",
    dialogConfirm: "전체 히스토리 지우기",
  },
  historySettings: {
    labelOn: "히스토리 기록: 켜짐",
    labelOff: "히스토리 기록: 꺼짐",
    tooltipOn:
      "쿼리 히스토리가 활성화되어 있습니다. 클릭하면 비활성화 — 이후 쿼리는 기록되지 않습니다. 기존 행은 유지됩니다(지우려면 Clear 사용).",
    tooltipOff:
      "쿼리 히스토리가 비활성화되어 있습니다. 클릭하면 활성화 — 이후 쿼리가 기록됩니다.",
  },
  rowCap: {
    ariaLabel: "쿼리 행 상한",
    tooltip: "쿼리 행 상한: {{count}}행",
    label: "쿼리당 최대 행 수",
    help: "이보다 큰 결과는 메모리 보호를 위해 fetch 단계에서 잘립니다. 정밀한 제어는 LIMIT을 사용하세요.",
    reset: "기본값",
    range: "허용 범위: {{min}}–{{max}}",
  },
  revealLogs: {
    label: "로그 폴더 열기",
    errorPrefix: "로그 폴더 열기 실패: {{msg}}",
  },
} as const;
