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
    // #1437 P2-4 — deb/rpm installs can't self-update; point at the package manager.
    manualHint:
      "Version {{version}} is available. Update via your package manager (apt/dnf).",
    // #1437 P2-8 — download progress + explicit failure feedback.
    downloading: "Downloading update {{version}}… {{percent}}%",
    // #1617 C3 — no Started event => unknown total; indeterminate, no percent.
    downloadingUnknown: "Downloading update {{version}}…",
    restarting: "Update downloaded — restarting…",
    failed: "Update failed. Please try again later.",
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
    manualHint:
      "버전 {{version}} 사용 가능. 패키지 매니저(apt/dnf)로 업데이트하세요.",
    downloading: "업데이트 {{version}} 다운로드 중… {{percent}}%",
    downloadingUnknown: "업데이트 {{version}} 다운로드 중…",
    restarting: "업데이트 완료 — 재시작 중…",
    failed: "업데이트 실패. 나중에 다시 시도하세요.",
  },
} as const;
