/**
 * `pages` 네임스페이스 — 페이지 레벨 UI 문자열 (HomePage, LauncherPage, WorkspacePage).
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  connections: "Connections",
  clearRecent: "Clear recent",
  clearRecentTitle: "Clear recent connections",
  importExport: "Import / Export",
  newGroup: "New Group",
  newConnection: "New Connection",
  toggleRecent: "Toggle Recent",
  recent: "Recent",
  resetRecentCollapse: "Reset recent collapse",
  resetRecentCollapseTitle: "Reset recent collapse to default",
  themePickerAria: "Theme picker: currently {{name}} ({{mode}})",
  launcher: "Launcher",
  backToConnections: "Back to connections",
  workspaceThemeAria: "Workspace theme: {{name}} ({{mode}})",
  changeTheme: "Change theme",
} as const;

export const ko = {
  connections: "연결",
  clearRecent: "최근 항목 지우기",
  clearRecentTitle: "최근 연결 목록 지우기",
  importExport: "가져오기 / 내보내기",
  newGroup: "새 그룹",
  newConnection: "새 연결",
  toggleRecent: "최근 항목 토글",
  recent: "최근",
  resetRecentCollapse: "최근 항목 접기 초기화",
  resetRecentCollapseTitle: "최근 항목 접기를 기본값으로 초기화",
  themePickerAria: "테마 선택기: 현재 {{name}} ({{mode}})",
  launcher: "런처",
  backToConnections: "연결 목록으로 돌아가기",
  workspaceThemeAria: "워크스페이스 테마: {{name}} ({{mode}})",
  changeTheme: "테마 변경",
} as const;
