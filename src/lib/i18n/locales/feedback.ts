/**
 * `feedback` 네임스페이스 — 로딩/취소 오버레이 등 비동기 피드백 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  loading: "Loading",
  cancel: "Cancel",
} as const;

export const ko = {
  loading: "로딩 중",
  cancel: "취소",
} as const;
