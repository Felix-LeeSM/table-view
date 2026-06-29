/**
 * `layout` 네임스페이스 — MainArea / Sidebar / SidebarModeToggle / TabBar /
 * TabItem 하드코딩 UI 문자열.
 *
 * en 값 = 마이그레이션 이전 리터럴 바이트 그대로 (렌더/E2E 불변).
 */

export const en = {
  mainArea: {
    mongoCollectionViewAria: "Mongo collection view",
    records: "Records",
    structure: "Structure",
    tableViewAria: "Table view",
    erd: "ERD",
    loadingWorkspaceAria: "Loading workspace",
    emptyTableLead:
      "Open a table from the sidebar, or start writing SQL against ",
    emptyKvLead:
      "Open a key from the sidebar, or start writing {{dbLabel}} commands against ",
    newQuery: "New Query",
    selectConnection: "Select a connection from the sidebar to get started",
  },
  sidebar: {
    schemasLabel: "Schemas",
    expandAll: "Expand all {{objectPlural}}",
    collapseAll: "Collapse all {{objectPlural}}",
    newQueryTabAria: "New Query Tab",
    query: "Query",
    themePickerAria: "Theme picker: currently {{name}} ({{mode}})",
    resizeAria: "Resize sidebar",
    resetWidthAria: "Reset sidebar width",
    resetWidthTitle: "Reset sidebar width to default",
    resetWidth: "Reset width",
  },
  sidebarModeToggle: {
    sidebarModeAria: "Sidebar mode",
    connections: "Connections",
    schemas: "Schemas",
    modeAria: "{{label}} mode",
  },
  tabBar: {
    openConnectionsAria: "Open connections",
    discardTitle: "Discard unsaved changes?",
    discardMessage:
      '"{{title}}" has unsaved changes. Closing the tab will discard them.',
    discardConfirm: "Discard and close",
  },
  tabItem: {
    mongoCollectionTabAria: "MongoDB collection tab",
    mongoQueryTabAria: "MongoDB query tab",
    unsavedChanges: "Unsaved changes",
    closeTabAria: "Close {{title}}",
  },
} as const;

export const ko = {
  mainArea: {
    mongoCollectionViewAria: "Mongo 컬렉션 뷰",
    records: "레코드",
    structure: "구조",
    tableViewAria: "테이블 뷰",
    erd: "ERD",
    loadingWorkspaceAria: "워크스페이스 불러오는 중",
    emptyTableLead:
      "사이드바에서 테이블을 열거나, 아래 연결에 SQL을 작성하세요 ",
    emptyKvLead:
      "사이드바에서 키를 열거나, 아래 연결에 {{dbLabel}} 명령을 작성하세요 ",
    newQuery: "새 쿼리",
    selectConnection: "사이드바에서 연결을 선택해 시작하세요",
  },
  sidebar: {
    schemasLabel: "스키마",
    expandAll: "{{objectPlural}} 모두 펼치기",
    collapseAll: "{{objectPlural}} 모두 접기",
    newQueryTabAria: "새 쿼리 탭",
    query: "쿼리",
    themePickerAria: "테마 선택: 현재 {{name}} ({{mode}})",
    resizeAria: "사이드바 크기 조절",
    resetWidthAria: "사이드바 너비 초기화",
    resetWidthTitle: "사이드바 너비를 기본값으로 초기화",
    resetWidth: "너비 초기화",
  },
  sidebarModeToggle: {
    sidebarModeAria: "사이드바 모드",
    connections: "연결",
    schemas: "스키마",
    modeAria: "{{label}} 모드",
  },
  tabBar: {
    openConnectionsAria: "열린 연결",
    discardTitle: "저장하지 않은 변경사항을 버리겠습니까?",
    discardMessage:
      '"{{title}}"에 저장하지 않은 변경사항이 있습니다. 탭을 닫으면 삭제됩니다.',
    discardConfirm: "버리고 닫기",
  },
  tabItem: {
    mongoCollectionTabAria: "MongoDB 컬렉션 탭",
    mongoQueryTabAria: "MongoDB 쿼리 탭",
    unsavedChanges: "저장하지 않은 변경사항",
    closeTabAria: "{{title}} 닫기",
  },
} as const;
