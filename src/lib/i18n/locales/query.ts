/**
 * `query` 네임스페이스 — query tab / query result / history / favorites 관련 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 영어 리터럴을 바이트 그대로 미러한다.
 */

export const en = {
  // Resize grips (keyboard, WCAG 2.1.1)
  resizeEditorAria: "Resize editor",
  resizeColumnAria: "Resize column",
  // ── DuckdbFileAnalyticsDialog ─────────────────────────────────────────────
  fileAnalytics: {
    dialogTitle: "Local file query",
    dialogDescriptionSrOnly: "Query a registered DuckDB local file source.",
    chooseFileAria: "Choose local file",
    chooseFile: "Choose File",
    previewResultAria: "Preview result",
    previewResult: "Preview result",
    sourceSQL: "Source SQL",
    runSourceQueryAria: "Run source query",
    runQuery: "Run Query",
    queryResultAria: "Query result",
    queryResult: "Query result",
    close: "Close",
  },

  // ── EditableQueryResultGrid ───────────────────────────────────────────────
  editableGrid: {
    readonlyNoPk: "Read-only — primary key required to edit",
    contextMenu: {
      showCellDetails: "Show Cell Details",
      editCell: "Edit Cell",
      deleteRow: "Delete Row",
    },
    discardAria: "Discard pending changes",
    discard: "Discard",
    commitAria: "Commit pending changes",
    commit: "Commit",
    noData: "No data",
    pkAria: "Primary key",
    editingCellAria: "Editing {{colName}}",
    sqlPreview: {
      title: "SQL Preview",
      descriptionSrOnly: "Preview SQL for raw query edits before executing",
      h3: "SQL Preview",
      closeAria: "Close SQL preview",
      cancel: "Cancel",
    },
  },

  // ── ExplainViewer ─────────────────────────────────────────────────────────
  explain: {
    viewerAria: "Explain viewer",
    header: "Explain ({{paradigm}})",
    refresh: "Refresh",
    planSummary: "Plan Summary",
    rawJson: "Raw JSON",
    // #1210 — Mongo explain sends filter only; sort/limit/projection are not
    // part of the plan, so warn when the query sets them.
    mongoFilterOnlyHint:
      "Filter-only plan — sort/limit/projection are not reflected and the actual execution may differ.",
  },

  // ── FavoritesPanel ────────────────────────────────────────────────────────
  favorites: {
    title: "Favorites",
    closeAria: "Close favorites",
    scope: {
      all: "All",
      global: "Global",
      connection: "This Connection",
      filterAria: "Filter: {{label}}",
    },
    empty: "No favorites yet",
    loadAria: "Load favorite: {{name}}",
    deleteAria: "Delete favorite: {{name}}",
  },

  // ── GlobalQueryLogPanel / QueryLog ────────────────────────────────────────
  queryLog: {
    title: "Query Log",
    searchPlaceholder: "Search queries...",
    newEntry: "New entry — refresh",
    noQueriesYet: "No queries executed yet",
    noMatchingQueries: "No matching queries",
    loading: "Loading…",
    loadMore: "Load more",
    closeAria: "Close query log",
  },

  // ── MongoQueryEditor ──────────────────────────────────────────────────────
  mongo: {
    editorAria: "MongoDB Query Editor",
  },

  // ── PendingChangesTray ────────────────────────────────────────────────────
  pendingChanges: {
    regionAria: "Pending changes",
    summary: "{{total}} change{{plural}} pending",
    nullInputTitle: "Empty input is treated as SQL NULL",
    revertEditAria: "Revert {{column}}",
    revertDeleteAria: "Revert delete row {{pkLabel}}",
  },

  // ── QueryHistoryDetailModal ───────────────────────────────────────────────
  historyDetail: {
    title: "Query history entry #{{id}}",
    loading: "Loading…",
    done: "Done",
    sectionSql: "SQL",
    sectionOriginalSql: "Original SQL",
    sectionRedacted: "Redacted",
  },

  // ── QueryHistoryPanel ─────────────────────────────────────────────────────
  historyPanel: {
    collapseAria: "Collapse tab history",
    expandAria: "Expand tab history",
    tabHistory: "Tab history",
    newEntry: "New entry — refresh",
    noQueriesYet: "No queries executed in this tab yet",
    loading: "Loading…",
    loadMore: "Load more",
    endOfHistory: "End of history",
    inspectEntryAria: "Inspect history entry {{id}}",
  },

  // ── QueryResultGrid ───────────────────────────────────────────────────────
  resultGrid: {
    executing: "Executing query...",
    dryRunBanner: "Dry Run — rolled back. No data was changed.",
    rowCapBanner:
      "Results truncated at {{count}} rows. Add a LIMIT clause, or raise the row cap in settings.",
    idlePrompt: "Press Cmd+Return to execute the query",
    cancelled: "Query cancelled",
    statementResultsAria: "Statement results",
    statementTab: "Statement {{n}} {{verb}}",
    statementFailed: "Statement {{n}} failed",
    unknownError: "Unknown error",
    editableBanner:
      "Editable — double-click a cell to edit, right-click for delete",
    readonlyBanner: "Read-only —",
    rowsAffected: "{{count}} row{{plural}} affected",
    queryExecutedSuccessfully: "Query executed successfully",
  },

  // ── QueryResultTable ──────────────────────────────────────────────────────
  resultTable: {
    noData: "No data",
  },

  // ── Toolbar ───────────────────────────────────────────────────────────────
  toolbar: {
    cancelQueryAria: "Cancel query",
    cancel: "Cancel",
    queryRunningAria: "Query running",
    running: "Running",
    runQueryAria: "Run query",
    run: "Run",
    dryRunAria: "Dry run query",
    dryRun: "Dry Run",
    explainAria: "Explain query",
    explain: "Explain",
    formatAria: "Format SQL",
    format: "Format",
    localFileAria: "Preview local file",
    localFile: "Local File",
    saveToFavoritesAria: "Save to favorites",
    save: "Save",
    openFavoritesAria: "Open favorites",
    favorites: "Favorites",
    favoritesCount: "Favorites ({{count}})",
    favoritePlaceholder: "Favorite name...",
    confirmSaveAria: "Confirm save",
    cancelSaveAria: "Cancel save",
  },

  // ── TabDbChip ─────────────────────────────────────────────────────────────
  tabDbChip: {
    currentDbAria: "Current database: {{database}}. Click to change.",
    noDbAria:
      "No database bound. Click to pick one — admin commands run without it.",
    noDatabase: "(no database)",
    loadingDatabases: "Loading databases…",
    noDatabasesAvailable: "No databases available.",
    availableDbsAria: "Available databases",
  },

  // ── RedisCommandEditor ────────────────────────────────────────────────────
  redis: {
    valkeyEditorAria: "Valkey Command Editor",
    redisEditorAria: "Redis Command Editor",
  },

  // ── ScalarOrListPanel ─────────────────────────────────────────────────────
  scalar: {
    noMatchingDocument: "No matching document",
    count: "Count",
  },

  // ── SearchQueryEditor ─────────────────────────────────────────────────────
  search: {
    editorAria: "Search Query Editor",
  },

  // ── SlowQueryPanel ────────────────────────────────────────────────────────
  slowQuery: {
    panelAria: "Slow queries",
    header: "Slow queries — {{db}}",
    refresh: "Refresh",
    emptyMongo:
      "system.profile is empty. Enable Mongo profiling with db.setProfilingLevel(level, slowms).",
    emptyPg: "pg_stat_statements returned no rows yet. Run some queries first.",
    colQuery: "Query",
    colCalls: "Calls",
    colMeanMs: "Mean (ms)",
    colTotalMs: "Total (ms)",
    colRows: "Rows",
    rawExtras: "Raw extras (first row)",
  },

  // ── SqlQueryEditor ────────────────────────────────────────────────────────
  sql: {
    editorAria: "SQL Query Editor",
  },

  // ── WriteSummaryPanel ─────────────────────────────────────────────────────
  write: {
    hideInsertedIds: "Hide inserted ids",
    showInsertedIds: "Show inserted ids",
    insertedOne: "Inserted 1 document",
    insertedMany: "Inserted {{count}} document(s)",
    modifiedOne: "Modified 1 document (matched {{matchedCount}})",
    modifiedMany: "Modified {{count}} document(s) (matched {{matchedCount}})",
    deletedOne: "Deleted 1 document",
    deletedMany: "Deleted {{count}} document(s)",
    bulkWriteAria: "bulkWrite result counters",
  },
} as const;

export const ko = {
  // Resize grips (keyboard, WCAG 2.1.1)
  resizeEditorAria: "편집기 크기 조절",
  resizeColumnAria: "열 크기 조절",
  fileAnalytics: {
    dialogTitle: "로컬 파일 쿼리",
    dialogDescriptionSrOnly: "등록된 DuckDB 로컬 파일 소스를 조회합니다.",
    chooseFileAria: "로컬 파일 선택",
    chooseFile: "파일 선택",
    previewResultAria: "미리보기 결과",
    previewResult: "미리보기 결과",
    sourceSQL: "소스 SQL",
    runSourceQueryAria: "소스 쿼리 실행",
    runQuery: "쿼리 실행",
    queryResultAria: "쿼리 결과",
    queryResult: "쿼리 결과",
    close: "닫기",
  },

  editableGrid: {
    readonlyNoPk: "읽기 전용 — 편집하려면 기본 키가 필요합니다",
    contextMenu: {
      showCellDetails: "셀 상세 보기",
      editCell: "셀 편집",
      deleteRow: "행 삭제",
    },
    discardAria: "대기 중인 변경 사항 취소",
    discard: "취소",
    commitAria: "대기 중인 변경 사항 커밋",
    commit: "커밋",
    noData: "데이터 없음",
    pkAria: "기본 키",
    editingCellAria: "{{colName}} 편집 중",
    sqlPreview: {
      title: "SQL 미리보기",
      descriptionSrOnly: "실행 전 원시 쿼리 편집의 SQL을 미리 봅니다",
      h3: "SQL 미리보기",
      closeAria: "SQL 미리보기 닫기",
      cancel: "취소",
    },
  },

  explain: {
    viewerAria: "실행 계획 뷰어",
    header: "실행 계획 ({{paradigm}})",
    refresh: "새로고침",
    planSummary: "계획 요약",
    rawJson: "원본 JSON",
    mongoFilterOnlyHint:
      "filter만 반영된 계획 — sort/limit/projection은 반영되지 않아 실제 실행과 다를 수 있습니다.",
  },

  favorites: {
    title: "즐겨찾기",
    closeAria: "즐겨찾기 닫기",
    scope: {
      all: "전체",
      global: "전역",
      connection: "이 연결",
      filterAria: "필터: {{label}}",
    },
    empty: "즐겨찾기가 없습니다",
    loadAria: "즐겨찾기 불러오기: {{name}}",
    deleteAria: "즐겨찾기 삭제: {{name}}",
  },

  queryLog: {
    title: "쿼리 로그",
    searchPlaceholder: "쿼리 검색...",
    newEntry: "새 항목 — 새로고침",
    noQueriesYet: "실행된 쿼리가 없습니다",
    noMatchingQueries: "일치하는 쿼리가 없습니다",
    loading: "불러오는 중…",
    loadMore: "더 불러오기",
    closeAria: "쿼리 로그 닫기",
  },

  mongo: {
    editorAria: "MongoDB 쿼리 편집기",
  },

  pendingChanges: {
    regionAria: "대기 중인 변경 사항",
    summary: "{{total}}개의 변경 사항 대기 중",
    nullInputTitle: "빈 입력은 SQL NULL로 처리됩니다",
    revertEditAria: "{{column}} 되돌리기",
    revertDeleteAria: "행 삭제 되돌리기 {{pkLabel}}",
  },

  historyDetail: {
    title: "쿼리 기록 항목 #{{id}}",
    loading: "불러오는 중…",
    done: "완료",
    sectionSql: "SQL",
    sectionOriginalSql: "원본 SQL",
    sectionRedacted: "편집됨",
  },

  historyPanel: {
    collapseAria: "탭 기록 접기",
    expandAria: "탭 기록 펼치기",
    tabHistory: "탭 기록",
    newEntry: "새 항목 — 새로고침",
    noQueriesYet: "이 탭에서 실행된 쿼리가 없습니다",
    loading: "불러오는 중…",
    loadMore: "더 불러오기",
    endOfHistory: "기록의 끝",
    inspectEntryAria: "기록 항목 {{id}} 검사",
  },

  resultGrid: {
    executing: "쿼리 실행 중...",
    dryRunBanner: "드라이 런 — 롤백되었습니다. 데이터가 변경되지 않았습니다.",
    rowCapBanner:
      "결과가 {{count}}행에서 잘렸습니다. LIMIT을 추가하거나 설정에서 행 상한을 조정하세요.",
    idlePrompt: "Cmd+Return을 눌러 쿼리를 실행하세요",
    cancelled: "쿼리가 취소되었습니다",
    statementResultsAria: "구문 결과",
    statementTab: "구문 {{n}} {{verb}}",
    statementFailed: "구문 {{n}} 실패",
    unknownError: "알 수 없는 오류",
    editableBanner: "편집 가능 — 셀을 더블클릭하여 편집, 우클릭으로 삭제",
    readonlyBanner: "읽기 전용 —",
    rowsAffected: "{{count}}개의 행이 영향받았습니다",
    queryExecutedSuccessfully: "쿼리가 성공적으로 실행되었습니다",
  },

  resultTable: {
    noData: "데이터 없음",
  },

  toolbar: {
    cancelQueryAria: "쿼리 취소",
    cancel: "취소",
    queryRunningAria: "쿼리 실행 중",
    running: "실행 중",
    runQueryAria: "쿼리 실행",
    run: "실행",
    dryRunAria: "드라이 런",
    dryRun: "드라이 런",
    explainAria: "실행 계획 보기",
    explain: "실행 계획",
    formatAria: "SQL 포맷",
    format: "포맷",
    localFileAria: "로컬 파일 미리보기",
    localFile: "로컬 파일",
    saveToFavoritesAria: "즐겨찾기에 저장",
    save: "저장",
    openFavoritesAria: "즐겨찾기 열기",
    favorites: "즐겨찾기",
    favoritesCount: "즐겨찾기 ({{count}})",
    favoritePlaceholder: "즐겨찾기 이름...",
    confirmSaveAria: "저장 확인",
    cancelSaveAria: "저장 취소",
  },

  tabDbChip: {
    currentDbAria: "현재 데이터베이스: {{database}}. 클릭하여 변경하세요.",
    noDbAria:
      "데이터베이스가 없습니다. 클릭하여 선택하세요 — 관리자 명령은 없이도 실행됩니다.",
    noDatabase: "(데이터베이스 없음)",
    loadingDatabases: "데이터베이스 불러오는 중…",
    noDatabasesAvailable: "사용 가능한 데이터베이스가 없습니다.",
    availableDbsAria: "사용 가능한 데이터베이스",
  },

  redis: {
    valkeyEditorAria: "Valkey 명령 편집기",
    redisEditorAria: "Redis 명령 편집기",
  },

  scalar: {
    noMatchingDocument: "일치하는 문서가 없습니다",
    count: "개수",
  },

  search: {
    editorAria: "검색 쿼리 편집기",
  },

  slowQuery: {
    panelAria: "느린 쿼리",
    header: "느린 쿼리 — {{db}}",
    refresh: "새로고침",
    emptyMongo:
      "system.profile이 비어 있습니다. db.setProfilingLevel(level, slowms)으로 Mongo 프로파일링을 활성화하세요.",
    emptyPg:
      "pg_stat_statements에 아직 데이터가 없습니다. 먼저 쿼리를 실행하세요.",
    colQuery: "쿼리",
    colCalls: "호출",
    colMeanMs: "평균 (ms)",
    colTotalMs: "합계 (ms)",
    colRows: "행",
    rawExtras: "원본 추가 정보 (첫 번째 행)",
  },

  sql: {
    editorAria: "SQL 쿼리 편집기",
  },

  write: {
    hideInsertedIds: "삽입된 ID 숨기기",
    showInsertedIds: "삽입된 ID 보기",
    insertedOne: "문서 1개가 삽입되었습니다",
    insertedMany: "문서 {{count}}개가 삽입되었습니다",
    modifiedOne: "문서 1개가 수정되었습니다 ({{matchedCount}}개 일치)",
    modifiedMany: "문서 {{count}}개가 수정되었습니다 ({{matchedCount}}개 일치)",
    deletedOne: "문서 1개가 삭제되었습니다",
    deletedMany: "문서 {{count}}개가 삭제되었습니다",
    bulkWriteAria: "bulkWrite 결과 카운터",
  },
} as const;
