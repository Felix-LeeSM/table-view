/**
 * `csvImport` 네임스페이스 — issue #1639 preview + #1640 commit CSV import
 * 위저드 문자열.
 *
 * en 값이 기본 locale 이므로 렌더/테스트 선택자의 SOT 다.
 */

export const en = {
  title: "Import CSV into {{schema}}.{{table}}",
  readOnlyNotice:
    "Preview and map columns, then import. The import runs in a single transaction and rolls back entirely on any error.",
  chooseFile: "Choose CSV file",
  chooseFileAria: "Choose a CSV file to preview",
  hasHeader: "First row is a header",
  hasHeaderAria: "Treat the first row as a header",
  emptyAsNull: "Empty field is NULL",
  emptyAsNullAria:
    "Map an empty CSV field to SQL NULL instead of an empty string",
  rowCount: "{{count}} rows",
  mappingRegionAria: "Column mapping",
  mappingLabel: "Column mapping ({{mapped}}/{{total}} mapped)",
  mapColumnAria: "CSV header for column {{column}}",
  skipColumn: "— skip —",
  previewRegionAria: "CSV preview",
  previewLabel: "Preview",
  import: "Import",
  confirmRegionAria: "Import confirmation",
  confirmTitle:
    "Import {{rows}} rows into {{schema}}.{{table}} across {{columns}} mapped columns?",
  confirmPolicy:
    "Runs as one transaction — every row is inserted, or the whole import is rolled back on any error.",
  confirmImport: "Confirm import",
  back: "Back",
  importing: "Importing {{count}} rows…",
  cancelImport: "Cancel",
  importSuccess: "Imported {{count}} rows.",
  close: "Close",
};

export const ko = {
  title: "{{schema}}.{{table}} 에 CSV 가져오기",
  readOnlyNotice:
    "미리보기 및 컬럼 매핑 후 가져오기. 가져오기는 단일 트랜잭션으로 실행되며 오류 시 전체 롤백됩니다.",
  chooseFile: "CSV 파일 선택",
  chooseFileAria: "미리 볼 CSV 파일 선택",
  hasHeader: "첫 행을 헤더로 사용",
  hasHeaderAria: "첫 행을 헤더로 처리",
  emptyAsNull: "빈 필드를 NULL 로",
  emptyAsNullAria: "빈 CSV 필드를 빈 문자열 대신 SQL NULL 로 매핑",
  rowCount: "{{count}}행",
  mappingRegionAria: "컬럼 매핑",
  mappingLabel: "컬럼 매핑 ({{mapped}}/{{total}} 매핑됨)",
  mapColumnAria: "{{column}} 컬럼의 CSV 헤더",
  skipColumn: "— 건너뛰기 —",
  previewRegionAria: "CSV 미리보기",
  previewLabel: "미리보기",
  import: "가져오기",
  confirmRegionAria: "가져오기 확인",
  confirmTitle:
    "{{rows}}행을 {{columns}}개 매핑 컬럼으로 {{schema}}.{{table}} 에 가져올까요?",
  confirmPolicy:
    "단일 트랜잭션으로 실행됩니다 — 모든 행이 삽입되거나, 오류 시 전체 가져오기가 롤백됩니다.",
  confirmImport: "가져오기 확인",
  back: "뒤로",
  importing: "{{count}}행 가져오는 중…",
  cancelImport: "취소",
  importSuccess: "{{count}}행을 가져왔습니다.",
  close: "닫기",
};
