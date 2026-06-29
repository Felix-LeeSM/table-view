/**
 * `datagrid` 네임스페이스 — DataGrid 컴포넌트 계열의 UI 문자열.
 *
 * en 값 = 마이그레이션 이전 하드코딩 리터럴을 바이트 그대로 미러.
 */

export const en = {
  // DataGridTable — empty state
  noRowsMatch: "0 rows match current filter",
  clearFiltersAria: "Clear filters",
  clearFilter: "Clear filter",
  tableEmpty: "Table is empty",

  // DataGridToolbar — status / pending
  sortedBy: "Sorted by",
  pendingEdits_one: "{{count}} edit",
  pendingEdits_other: "{{count}} edits",
  pendingNew: "{{count}} new",
  pendingDel: "{{count}} del",
  selectedCount: "{{count}} selected",

  // DataGridToolbar — buttons
  commit: "Commit",
  commitAria: "Commit changes",
  discard: "Discard",
  discardAria: "Discard changes",
  undo: "Undo",
  undoAria: "Undo last pending change",
  undoTitle: "Undo (Cmd+Z) — pending changes only",

  // Column resize grip (keyboard, WCAG 2.1.1)
  resizeColumnAria: "Resize column",

  // DataGridToolbar — column / view controls
  resetColumnWidthsAria: "Reset column widths",
  resetColumnWidthsTitle: "Reset column widths to default",
  toggleQuickLookAria: "Toggle Quick Look",
  toggleQuickLookTitle: "Quick Look (Cmd+L)",
  toggleFiltersAria: "Toggle filters",
  toggleFiltersTitle: "Toggle filters",

  // DataGridToolbar — pagination
  firstPage: "First page",
  prevPage: "Previous page",
  nextPage: "Next page",
  lastPage: "Last page",
  pageSizeAria: "Page size",
  jumpToPage: "Jump to page",

  // BlobViewerDialog
  blobViewerPrefix: "BLOB Viewer —",
  blobEmpty: "(empty)",
  blobBinary: "(binary data — cannot decode as UTF-8)",
  byteCount_one: "{{count}} byte",
  byteCount_other: "{{count}} bytes",
  tabHex: "Hex",
  tabText: "Text",

  // CellDetailDialog
  cellDetailTitle: "Cell Detail —",
  charCount_one: "{{count}} char",
  charCount_other: "{{count}} chars",
  lineCount_one: "{{count}} line",
  lineCount_other: "{{count}} lines",
  copyCellAria: "Copy cell value",
  copied: "Copied",
  copy: "Copy",
  emptyString: "(empty string)",

  // contextMenu items
  showCellDetails: "Show Cell Details",
  editCell: "Edit Cell",
  setToNull: "Set to NULL",
  deleteRow: "Delete Row",
  duplicateRow: "Duplicate Row",
  copyAsPlainText: "Copy as Plain Text",
  copyAsJson: "Copy as JSON",
  copyAsCsv: "Copy as CSV",
  copyAsSqlInsert: "Copy as SQL Insert",

  // HeaderRow
  sortByTitle: "Sort by {{col}}",
  primaryKey: "Primary Key",
  columnActionsAria: "Column actions for {{col}}",
  sortAsc: "Sort ASC",
  sortDesc: "Sort DESC",
  addToSortAsc: "Add to sort ASC",
  addToSortDesc: "Add to sort DESC",
  clearSortForColumn: "Clear sort for this column",
  clearAllSorts: "Clear all sorts",
  hideColumn: "Hide column",
  resetColumnWidths: "Reset column widths",
  showAllColumns: "Show all columns",

  // DataRow — cell editor
  editingNullAria: "Editing {{col}} — currently NULL",
  typeToEdit: "Type to edit · Esc to cancel",
  editingAria: "Editing {{col}}",
  viewBlobAria: "View BLOB data for {{col}}",
  nestedItems_one: "{{count}} item",
  nestedItems_other: "{{count}} items",
  expandAria: "Expand {{col}}",
  closeAria: "Close {{col}}",
  openFkAria: "Open referenced row in {{schemaTable}}",
  goToFkTitle: "Go to {{schemaTable}} ({{column}})",

  // useDataGridEdit — toast
  noChangesToCommit: "No changes to commit",

  // useDataGridPreviewCommit / paradigmEditAdapter — commit lifecycle
  commitFlow: {
    committed_one: "{{count}} change committed.",
    committed_other: "{{count}} changes committed.",
    committedDoc_one: "{{count}} document change committed.",
    committedDoc_other: "{{count}} document changes committed.",
    failed: "Failed to commit changes.",
    failedDoc: "Failed to commit document changes.",
    rolledBack: "Commit failed — all changes rolled back: {{message}}",
    commitFailedDoc:
      "Commit failed. MongoDB bulk writes are ordered but not transactional in this app. If a later command fails, earlier document writes may already be committed; pending edits stay available for retry. {{message}}",
    defaultCommitFailed: "Commit failed.",
    blockedBySafeMode: "Blocked by Safe Mode",
    confirmationRequired: "Confirmation required",
    warnCancelled:
      "Safe Mode (warn): confirmation cancelled — no changes committed",
  },
} as const;

export const ko = {
  // DataGridTable — empty state
  noRowsMatch: "현재 필터와 일치하는 행이 없습니다",
  clearFiltersAria: "필터 지우기",
  clearFilter: "필터 지우기",
  tableEmpty: "테이블이 비어 있습니다",

  // DataGridToolbar — status / pending
  sortedBy: "정렬 기준:",
  pendingEdits_one: "{{count}}개 수정",
  pendingEdits_other: "{{count}}개 수정",
  pendingNew: "{{count}}개 추가",
  pendingDel: "{{count}}개 삭제",
  selectedCount: "{{count}}개 선택됨",

  // DataGridToolbar — buttons
  commit: "커밋",
  commitAria: "변경사항 커밋",
  discard: "취소",
  discardAria: "변경사항 취소",
  undo: "실행 취소",
  undoAria: "마지막 대기 변경 실행 취소",
  undoTitle: "실행 취소 (Cmd+Z) — 대기 중인 변경사항만",

  // Column resize grip (keyboard, WCAG 2.1.1)
  resizeColumnAria: "열 크기 조절",

  // DataGridToolbar — column / view controls
  resetColumnWidthsAria: "열 너비 초기화",
  resetColumnWidthsTitle: "열 너비를 기본값으로 초기화",
  toggleQuickLookAria: "Quick Look 전환",
  toggleQuickLookTitle: "Quick Look (Cmd+L)",
  toggleFiltersAria: "필터 전환",
  toggleFiltersTitle: "필터 전환",

  // DataGridToolbar — pagination
  firstPage: "첫 페이지",
  prevPage: "이전 페이지",
  nextPage: "다음 페이지",
  lastPage: "마지막 페이지",
  pageSizeAria: "페이지 크기",
  jumpToPage: "페이지로 이동",

  // BlobViewerDialog
  blobViewerPrefix: "BLOB 뷰어 —",
  blobEmpty: "(비어 있음)",
  blobBinary: "(바이너리 데이터 — UTF-8로 디코딩할 수 없습니다)",
  byteCount_one: "{{count}} 바이트",
  byteCount_other: "{{count}} 바이트",
  tabHex: "헥스",
  tabText: "텍스트",

  // CellDetailDialog
  cellDetailTitle: "셀 상세 —",
  charCount_one: "{{count}}자",
  charCount_other: "{{count}}자",
  lineCount_one: "{{count}}줄",
  lineCount_other: "{{count}}줄",
  copyCellAria: "셀 값 복사",
  copied: "복사됨",
  copy: "복사",
  emptyString: "(빈 문자열)",

  // contextMenu items
  showCellDetails: "셀 상세 보기",
  editCell: "셀 편집",
  setToNull: "NULL로 설정",
  deleteRow: "행 삭제",
  duplicateRow: "행 복제",
  copyAsPlainText: "일반 텍스트로 복사",
  copyAsJson: "JSON으로 복사",
  copyAsCsv: "CSV로 복사",
  copyAsSqlInsert: "SQL Insert로 복사",

  // HeaderRow
  sortByTitle: "{{col}} 기준 정렬",
  primaryKey: "기본 키",
  columnActionsAria: "{{col}} 열 작업",
  sortAsc: "오름차순 정렬",
  sortDesc: "내림차순 정렬",
  addToSortAsc: "오름차순 정렬에 추가",
  addToSortDesc: "내림차순 정렬에 추가",
  clearSortForColumn: "이 열의 정렬 해제",
  clearAllSorts: "모든 정렬 해제",
  hideColumn: "열 숨기기",
  resetColumnWidths: "열 너비 초기화",
  showAllColumns: "모든 열 표시",

  // DataRow — cell editor
  editingNullAria: "{{col}} 편집 중 — 현재 NULL",
  typeToEdit: "입력하여 편집 · Esc로 취소",
  editingAria: "{{col}} 편집 중",
  viewBlobAria: "{{col}}의 BLOB 데이터 보기",
  nestedItems_one: "{{count}}개 항목",
  nestedItems_other: "{{count}}개 항목",
  expandAria: "{{col}} 펼치기",
  closeAria: "{{col}} 닫기",
  openFkAria: "{{schemaTable}}에서 참조된 행 열기",
  goToFkTitle: "{{schemaTable}}으로 이동 ({{column}})",

  // useDataGridEdit — toast
  noChangesToCommit: "커밋할 변경사항이 없습니다",

  // useDataGridPreviewCommit / paradigmEditAdapter — commit lifecycle
  commitFlow: {
    committed_one: "변경 {{count}}건 커밋됨.",
    committed_other: "변경 {{count}}건 커밋됨.",
    committedDoc_one: "문서 변경 {{count}}건 커밋됨.",
    committedDoc_other: "문서 변경 {{count}}건 커밋됨.",
    failed: "변경사항을 커밋하지 못했습니다.",
    failedDoc: "문서 변경사항을 커밋하지 못했습니다.",
    rolledBack: "커밋 실패 — 모든 변경사항이 롤백되었습니다: {{message}}",
    commitFailedDoc:
      "커밋 실패. MongoDB 대량 쓰기는 이 앱에서 순서대로 처리되지만 트랜잭션은 아닙니다. 이후 명령이 실패하면 앞서 기록된 문서 쓰기는 이미 커밋되었을 수 있습니다. 보류 중인 편집은 재시도할 수 있도록 유지됩니다. {{message}}",
    defaultCommitFailed: "커밋 실패.",
    blockedBySafeMode: "세이프 모드에 의해 차단됨",
    confirmationRequired: "확인 필요",
    warnCancelled:
      "세이프 모드(경고): 확인이 취소됨 — 변경사항이 커밋되지 않았습니다",
  },
} as const;
