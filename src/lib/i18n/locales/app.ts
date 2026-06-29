/**
 * `app` 네임스페이스 — App / AppRouter 수준 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  title: {
    launcher: "Table View",
    workspace: "Table View — Workspace",
  },
} as const;

export const ko = {
  title: {
    launcher: "Table View",
    workspace: "Table View — 워크스페이스",
  },
} as const;
