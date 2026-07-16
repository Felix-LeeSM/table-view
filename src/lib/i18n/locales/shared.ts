/**
 * `shared` 네임스페이스 — src/components/shared/ 공용 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  // BackendPendingPlaceholder
  backendPending: "Backend support pending — tracked in",

  // BsonTreeViewer
  bson: {
    treeAriaLabel: "BSON document tree",
    noDocumentSelected: "No document selected",
    nodeAria: "{{keyLabel}} node",
    collapse: "Collapse {{keyLabel}}",
    expand: "Expand {{keyLabel}}",
    copyPath: "Copy path {{path}}",
    copyValue: "Copy value at {{path}}",
    copied: "Copied {{copied}}",
    arrayItems: "[{{len}} items]",
    objectKeys: "{{{len}} keys}",
  },

  // ContextMenu
  contextMenuLabel: "Context menu",

  // CopyTextButton
  nothingToCopy: "Nothing to copy.",
  copiedToClipboard: "Copied to clipboard.",
  copyFailed: "Copy failed: {{message}}",

  // ErrorBoundary
  errorTitle: "Something went wrong",
  errorFallback: "An unexpected error occurred.",
  reload: "Reload",
  retry: "Retry",
  asyncError: "Something failed in the background: {{message}}",

  // ExportButton
  export: {
    label: "Export",
    nothingToExport: "Nothing to export.",
    singleTableOnly: "Single-table SELECT only",
    exportAs: "Export as {{label}}",
    csv: "CSV",
    tsv: "TSV",
    sql: "SQL INSERT",
    json: "JSON",
    cancelAria: "Cancel export",
    cancelTooltip: "Stop export",
  },

  // Logo
  logoAlt: "Table View",

  // QuickLookPanel — document body
  documentDetails: {
    heading: "Document Details —",
    closeLabel: "Close document details",
    multiSelect: "({{count}} selected, showing first)",
  },

  // QuickLookPanel — RDB body
  rowDetails: {
    heading: "Row Details —",
    closeLabel: "Close row details",
    multiSelect: "({{count}} selected, showing first)",
  },

  // QuickLookPanel — FieldRow
  fieldRow: {
    viewBlob: "View BLOB data for {{column}}",
    valueFor: "Value for {{column}}",
    readOnly: "(read-only)",
    editValueFor: "Edit value for {{column}}",
    setNullFor: "Set NULL for {{column}}",
    setNull: "Set NULL",
    blob: "(BLOB)",
  },

  // QuickLookPanel — shell chrome
  shell: {
    resizeLabel: "Resize Quick Look panel",
    modified: "● Modified",
    toggleEdit: "Toggle edit mode",
    exitEdit: "Exit edit mode",
    enterEdit: "Enter edit mode",
  },

  // QuickOpen
  quickOpen: {
    title: "Quick Open",
    description:
      "Search tables, views, and functions across connected databases",
    placeholder: "Search tables, views, functions...",
    noConnections: "No connected databases — open a connection first",
    noResults: "No results",
    kindSchema: "Schema",
    kindTable: "Table",
    kindView: "View",
    kindFunction: "Function",
    kindProcedure: "Procedure",
    closeAria: "Close quick open",
  },

  // PgValueSearch (#1525) — read-only cross-table value search (PostgreSQL)
  valueSearch: {
    title: "Search Data",
    description:
      "Find a value across the text columns of a PostgreSQL schema (read-only)",
    placeholder: "Value to find...",
    run: "Search",
    cancel: "Cancel",
    pgOnly: "Data search is available for PostgreSQL connections.",
    noConnection: "Open a PostgreSQL connection first.",
    noResults: "No matches found.",
    running: "Searching...",
    truncated: "Results limited by the row cap — refine the term for more.",
    resultCount_one: "{{count}} match",
    resultCount_other: "{{count}} matches",
    closeAria: "Close data search",
  },

  // ShortcutCheatsheet
  shortcuts: {
    title: "Keyboard shortcuts",
    description: "Press ? or Cmd+/ to toggle this panel.",
    searchLabel: "Search shortcuts",
    searchPlaceholder: "Search shortcuts...",
    noMatch: "No shortcuts match",
    groupTabs: "Tabs",
    groupEditing: "Editing",
    groupNavigation: "Navigation",
    groupPanels: "Panels",
    groupMisc: "Misc",
    closeTab: "Close tab",
    newQueryTab: "New query tab",
    reopenLastTab: "Reopen last closed tab",
    switchToTab: "Switch to tab 1–9",
    commitChanges: "Commit changes",
    formatSql: "Format SQL",
    uglifySql: "Uglify SQL",
    quickOpen: "Quick open",
    searchData: "Search data (PostgreSQL)",
    refresh: "Refresh",
    cancelQuery: "Cancel running query",
    toggleHomeWorkspace: "Toggle Home/Workspace",
    toggleFavorites: "Toggle favorites",
    toggleQueryLog: "Toggle global query log",
    showCheatsheet: "Show this cheatsheet",
  },

  // QueryHistorySourceBadge — tooltip titles
  historyBadge: {
    gridTitle: "Recorded from a grid commit (cell edits / row delete)",
    ddlTitle:
      "Recorded from a structure editor (columns / indexes / constraints / drop)",
    mongoTitle: "Recorded from a Mongo single-document op (insert)",
    explainTitle: "Recorded from the query editor Explain plan action",
    fileTitle: "Recorded from a DuckDB local-file source query",
    fileCustomTitle: "Recorded from {{label}} DuckDB local-file source query",
    sidebarTitle:
      "Recorded from a sidebar table/collection preview (DataGrid open)",
  },

  // HistoryCollapseToggle (#1309) — shared show-more/collapse for history surfaces
  historyCollapse: {
    showMore: "Show {{count}} more",
    showLess: "Show less",
    expandAria: "Show {{count}} more history entries",
    collapseAria: "Show fewer history entries",
  },
} as const;

export const ko = {
  // BackendPendingPlaceholder
  backendPending: "백엔드 지원 대기 중 — 트래킹:",

  // BsonTreeViewer
  bson: {
    treeAriaLabel: "BSON 문서 트리",
    noDocumentSelected: "선택된 문서 없음",
    nodeAria: "{{keyLabel}} 노드",
    collapse: "{{keyLabel}} 접기",
    expand: "{{keyLabel}} 펼치기",
    copyPath: "경로 복사 {{path}}",
    copyValue: "값 복사 {{path}}",
    copied: "{{copied}} 복사됨",
    arrayItems: "[{{len}}개 항목]",
    objectKeys: "{{{len}}개 키}",
  },

  // ContextMenu
  contextMenuLabel: "컨텍스트 메뉴",

  // CopyTextButton
  nothingToCopy: "복사할 내용이 없습니다.",
  copiedToClipboard: "클립보드에 복사되었습니다.",
  copyFailed: "복사 실패: {{message}}",

  // ErrorBoundary
  errorTitle: "오류가 발생했습니다",
  errorFallback: "예기치 않은 오류가 발생했습니다.",
  reload: "다시 로드",
  retry: "다시 시도",
  asyncError: "백그라운드 작업이 실패했습니다: {{message}}",

  // ExportButton
  export: {
    label: "내보내기",
    nothingToExport: "내보낼 내용이 없습니다.",
    singleTableOnly: "단일 테이블 SELECT만 가능",
    exportAs: "{{label}}(으)로 내보내기",
    csv: "CSV",
    tsv: "TSV",
    sql: "SQL INSERT",
    json: "JSON",
    cancelAria: "내보내기 취소",
    cancelTooltip: "내보내기 중지",
  },

  // Logo
  logoAlt: "Table View",

  // QuickLookPanel — document body
  documentDetails: {
    heading: "문서 상세 —",
    closeLabel: "문서 상세 닫기",
    multiSelect: "({{count}}개 선택됨, 첫 번째 표시)",
  },

  // QuickLookPanel — RDB body
  rowDetails: {
    heading: "행 상세 —",
    closeLabel: "행 상세 닫기",
    multiSelect: "({{count}}개 선택됨, 첫 번째 표시)",
  },

  // QuickLookPanel — FieldRow
  fieldRow: {
    viewBlob: "{{column}} BLOB 데이터 보기",
    valueFor: "{{column}} 값",
    readOnly: "(읽기 전용)",
    editValueFor: "{{column}} 값 편집",
    setNullFor: "{{column}} NULL 설정",
    setNull: "NULL 설정",
    blob: "(BLOB)",
  },

  // QuickLookPanel — shell chrome
  shell: {
    resizeLabel: "Quick Look 패널 크기 조절",
    modified: "● 수정됨",
    toggleEdit: "편집 모드 전환",
    exitEdit: "편집 모드 종료",
    enterEdit: "편집 모드 시작",
  },

  // QuickOpen
  quickOpen: {
    title: "빠른 열기",
    description: "연결된 데이터베이스의 테이블, 뷰, 함수 검색",
    placeholder: "테이블, 뷰, 함수 검색...",
    noConnections: "연결된 데이터베이스 없음 — 먼저 연결을 열어주세요",
    noResults: "결과 없음",
    kindSchema: "스키마",
    kindTable: "테이블",
    kindView: "뷰",
    kindFunction: "함수",
    kindProcedure: "프로시저",
    closeAria: "빠른 열기 닫기",
  },

  // PgValueSearch (#1525) — 읽기 전용 테이블 값 전역 검색 (PostgreSQL)
  valueSearch: {
    title: "데이터 검색",
    description:
      "PostgreSQL 스키마의 텍스트 컬럼 전체에서 값을 찾습니다 (읽기 전용)",
    placeholder: "찾을 값...",
    run: "검색",
    cancel: "취소",
    pgOnly: "데이터 검색은 PostgreSQL 연결에서 사용할 수 있습니다.",
    noConnection: "먼저 PostgreSQL 연결을 열어주세요.",
    noResults: "일치하는 결과 없음.",
    running: "검색 중...",
    truncated: "행 제한으로 결과가 잘렸습니다 — 검색어를 좁혀보세요.",
    resultCount_one: "{{count}}건 일치",
    resultCount_other: "{{count}}건 일치",
    closeAria: "데이터 검색 닫기",
  },

  // ShortcutCheatsheet
  shortcuts: {
    title: "키보드 단축키",
    description: "? 또는 Cmd+/ 를 눌러 이 패널을 토글하세요.",
    searchLabel: "단축키 검색",
    searchPlaceholder: "단축키 검색...",
    noMatch: "일치하는 단축키 없음",
    groupTabs: "탭",
    groupEditing: "편집",
    groupNavigation: "탐색",
    groupPanels: "패널",
    groupMisc: "기타",
    closeTab: "탭 닫기",
    newQueryTab: "새 쿼리 탭",
    reopenLastTab: "마지막으로 닫은 탭 다시 열기",
    switchToTab: "1–9번 탭으로 전환",
    commitChanges: "변경 사항 커밋",
    formatSql: "SQL 포매팅",
    uglifySql: "SQL 최소화",
    quickOpen: "빠른 열기",
    searchData: "데이터 검색 (PostgreSQL)",
    refresh: "새로 고침",
    cancelQuery: "실행 중인 쿼리 취소",
    toggleHomeWorkspace: "홈/워크스페이스 전환",
    toggleFavorites: "즐겨찾기 전환",
    toggleQueryLog: "전역 쿼리 로그 전환",
    showCheatsheet: "이 치트시트 표시",
  },

  // QueryHistorySourceBadge — tooltip titles
  historyBadge: {
    gridTitle: "그리드 커밋(셀 편집 / 행 삭제)에서 기록됨",
    ddlTitle: "구조 편집기(컬럼 / 인덱스 / 제약 조건 / 삭제)에서 기록됨",
    mongoTitle: "Mongo 단일 문서 작업(insert)에서 기록됨",
    explainTitle: "쿼리 편집기 Explain 플랜 작업에서 기록됨",
    fileTitle: "DuckDB 로컬 파일 소스 쿼리에서 기록됨",
    fileCustomTitle: "{{label}} DuckDB 로컬 파일 소스 쿼리에서 기록됨",
    sidebarTitle: "사이드바 테이블/컬렉션 미리보기(DataGrid 열기)에서 기록됨",
  },

  // HistoryCollapseToggle (#1309) — shared show-more/collapse for history surfaces
  historyCollapse: {
    showMore: "{{count}}개 더 보기",
    showLess: "접기",
    expandAria: "히스토리 {{count}}개 더 보기",
    collapseAria: "히스토리 접기",
  },
} as const;
