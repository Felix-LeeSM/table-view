/**
 * `app` 네임스페이스 — App / AppRouter 수준 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  title: {
    launcher: "Table View",
    workspace: "Table View — Workspace",
    workspaceNamed: "{{name}} — Table View",
  },
  update: {
    title: "Update available",
    prompt: "A new version {{version}} is available — install it now?",
    install: "Install & restart",
    later: "Later",
  },
} as const;

export const ko = {
  title: {
    launcher: "Table View",
    workspace: "Table View — 워크스페이스",
    workspaceNamed: "{{name}} — Table View",
  },
  update: {
    title: "업데이트 사용 가능",
    prompt: "새 버전 {{version}} 있음 — 지금 설치할까요?",
    install: "설치 후 재시작",
    later: "나중에",
  },
} as const;
