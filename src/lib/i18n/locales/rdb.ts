/**
 * `rdb` 네임스페이스 — RDB DataGrid / FilterBar 관련 UI 문자열.
 *
 * en 값은 마이그레이션 이전 하드코딩 리터럴을 바이트 그대로 미러한다 —
 * 기본 locale 이 en 이므로 렌더/테스트/E2E 선택자가 불변이다.
 */

export const en = {
  filterBar: {
    title: "Filters",
    structured: "Structured",
    rawSql: "Raw SQL",
    closeAria: "Close filter bar",
    rawSqlPlaceholder: "e.g. id = 13 AND name LIKE '%test%'",
    rawSqlAria: "Raw SQL WHERE clause",
    clear: "Clear",
    apply: "Apply",
    filterColumnAria: "Filter column",
    filterOperatorAria: "Filter operator",
    valuePlaceholder: "Value...",
    valueForColumnAria: "Filter value for {{col}}",
    removeFilterAria: "Remove filter",
    addFilter: "Add Filter",
    clearAll: "Clear All",
  },
  executedQueryBar: {
    query: "Query",
    hideQueryAria: "Hide query",
    showQueryAria: "Show query",
    executedSqlAria: "Executed SQL query",
  },
  hiddenColumnsBadge: {
    oneColumnHidden: "1 column hidden",
    manyColumnsHidden: "{{count}} columns hidden",
    badgeAria: "Hidden columns badge",
    showAll: "Show all",
    showAllAria: "Show all hidden columns",
  },
  sqlPreviewDialog: {
    title: "SQL Preview",
    description: "Preview SQL before executing",
    copySqlAria: "Copy SQL to clipboard",
    closeAria: "Close SQL preview",
    cancel: "Cancel",
    executeAria: "Execute SQL",
    commitErrorSummary:
      "executed: {{executed}}, failed at: {{failedAt}} of {{total}}",
  },
  useRdbTableData: {
    activeDbSynced:
      "Active DB synced to '{{actual}}'. Re-open the table to refresh.",
  },
} as const;

export const ko = {
  filterBar: {
    title: "필터",
    structured: "구조화",
    rawSql: "Raw SQL",
    closeAria: "필터 바 닫기",
    rawSqlPlaceholder: "예: id = 13 AND name LIKE '%test%'",
    rawSqlAria: "Raw SQL WHERE 절",
    clear: "지우기",
    apply: "적용",
    filterColumnAria: "필터 컬럼",
    filterOperatorAria: "필터 연산자",
    valuePlaceholder: "값...",
    valueForColumnAria: "{{col}} 필터 값",
    removeFilterAria: "필터 제거",
    addFilter: "필터 추가",
    clearAll: "전체 지우기",
  },
  executedQueryBar: {
    query: "쿼리",
    hideQueryAria: "쿼리 숨기기",
    showQueryAria: "쿼리 보기",
    executedSqlAria: "실행된 SQL 쿼리",
  },
  hiddenColumnsBadge: {
    oneColumnHidden: "1개 컬럼 숨김",
    manyColumnsHidden: "{{count}}개 컬럼 숨김",
    badgeAria: "숨긴 컬럼 배지",
    showAll: "모두 표시",
    showAllAria: "숨긴 컬럼 모두 표시",
  },
  sqlPreviewDialog: {
    title: "SQL 미리보기",
    description: "실행 전 SQL 미리보기",
    copySqlAria: "SQL을 클립보드에 복사",
    closeAria: "SQL 미리보기 닫기",
    cancel: "취소",
    executeAria: "SQL 실행",
    commitErrorSummary:
      "실행됨: {{executed}}, 실패 위치: {{failedAt}} / {{total}}",
  },
  useRdbTableData: {
    activeDbSynced:
      "활성 DB가 '{{actual}}'로 동기화되었습니다. 테이블을 다시 열어 새로고침하세요.",
  },
} as const;
