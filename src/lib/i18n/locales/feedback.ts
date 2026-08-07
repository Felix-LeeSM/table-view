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
  // #2183 — boot found connections.json gone and restored it from the backup
  // beside it. #2187 — the backend raises this only when that backup put
  // something back, and "something" is connections *or* groups, so the text
  // names both: a groups-only backup shows this over a connection list that is
  // still empty afterwards. Sticky, because the user has to check the result in
  // both directions — the backup predates the last change that rotated it, so
  // an entry added since then is missing from it and one deleted since then is
  // back.
  connectionsRestoredFromBackup:
    "Your saved connections and groups were missing and have been restored from the backup beside them (connections.json.bak). The backup is from before your last change, so please check the list both ways — something you added may be missing, and something you deleted may be back.",
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
  // #2183 / #2187 — en 주석과 같은 계약이다. 백업이 실제로 무언가를 돌려놨을
  // 때만 뜨고, 그 무언가는 연결 또는 그룹이라 문장이 둘 다 이름을 불러야 한다.
  // 빠진 항목과 되살아난 항목도 둘 다 말한다.
  connectionsRestoredFromBackup:
    "저장해 둔 연결과 그룹이 사라져서 옆의 백업(connections.json.bak)에서 되살렸습니다. 백업은 마지막 변경 직전 상태라 최근에 추가한 항목이 빠져 있거나 지운 항목이 되살아났을 수 있습니다. 목록을 확인해 주세요.",
} as const;
