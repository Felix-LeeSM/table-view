/**
 * `pages` 네임스페이스 — 페이지 레벨 UI 문자열 (HomePage, LauncherPage, WorkspacePage).
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  connections: "Connections",
  // #2433 — `clearRecent` / `clearRecentTitle` left with the launcher action
  // bar's Eraser button. The strings the Recent list uses now live under
  // `recent.clear*` in featuresConnection.ts.
  importExport: "Import / Export",
  newGroup: "New Group",
  newConnection: "New Connection",
  themePickerAria: "Theme picker: currently {{name}} ({{mode}})",
  launcher: "Launcher",
  backToConnections: "Back to connections",
  workspaceThemeAria: "Workspace theme: {{name}} ({{mode}})",
  changeTheme: "Change theme",
  workspaceSidebarAria: "Workspace sidebar",
  workspaceHeading: "Workspace",
} as const;

export const ko = {
  connections: "연결",
  importExport: "가져오기 / 내보내기",
  newGroup: "새 그룹",
  newConnection: "새 연결",
  themePickerAria: "테마 선택기: 현재 {{name}} ({{mode}})",
  launcher: "런처",
  backToConnections: "연결 목록으로 돌아가기",
  workspaceThemeAria: "워크스페이스 테마: {{name}} ({{mode}})",
  changeTheme: "테마 변경",
  workspaceSidebarAria: "워크스페이스 사이드바",
  workspaceHeading: "워크스페이스",
} as const;
