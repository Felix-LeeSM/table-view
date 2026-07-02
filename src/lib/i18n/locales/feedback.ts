/**
 * `feedback` 네임스페이스 — 로딩/취소 오버레이 등 비동기 피드백 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  loading: "Loading",
  cancel: "Cancel",
  // loadAllFromSnapshot — boot hydrate failure (sticky toast + retry action)
  snapshotLoadFailed:
    "Failed to load app state from snapshot. Click Retry to try again.",
  retry: "Retry",
  // #1092 — persist_* IPC write failure (favorites / MRU / settings). The
  // SQLite write is the single SOT after the W3 cut, so a failed write is
  // silently lost on the next boot unless the user is told.
  storageWriteFailed:
    "Couldn't save your changes — they may be lost when you restart.",
  // one-time column-prefs reset notice (boot migration)
  columnPrefsReset:
    "Per-table preferences will reset once — column widths and hidden columns now sync across windows.",
} as const;

export const ko = {
  loading: "로딩 중",
  cancel: "취소",
  // loadAllFromSnapshot — boot hydrate failure (sticky toast + retry action)
  snapshotLoadFailed:
    "스냅샷에서 앱 상태를 불러오지 못했습니다. 다시 시도하려면 재시도를 클릭하세요.",
  retry: "재시도",
  // #1092 — persist_* IPC write failure (favorites / MRU / settings).
  storageWriteFailed:
    "변경 사항을 저장하지 못했습니다 — 앱을 다시 시작하면 사라질 수 있습니다.",
  // one-time column-prefs reset notice (boot migration)
  columnPrefsReset:
    "테이블별 환경설정이 한 번 초기화됩니다 — 컬럼 너비와 숨긴 컬럼이 이제 창 간에 동기화됩니다.",
} as const;
