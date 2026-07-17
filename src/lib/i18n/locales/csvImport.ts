/**
 * `csvImport` 네임스페이스 — issue #1639 Stage 1 CSV import 위저드 문자열.
 *
 * en 값이 기본 locale 이므로 렌더/테스트 선택자의 SOT 다.
 */

export const en = {
  title: "Import CSV into {{schema}}.{{table}}",
  readOnlyNotice:
    "Preview and map columns. This step is read-only — nothing is written yet.",
  chooseFile: "Choose CSV file",
  chooseFileAria: "Choose a CSV file to preview",
  hasHeader: "First row is a header",
  hasHeaderAria: "Treat the first row as a header",
  rowCount: "{{count}} rows",
  mappingRegionAria: "Column mapping",
  mappingLabel: "Column mapping ({{mapped}}/{{total}} mapped)",
  mapColumnAria: "CSV header for column {{column}}",
  skipColumn: "— skip —",
  previewRegionAria: "CSV preview",
  previewLabel: "Preview",
  commitPending: "Import runs in a later step",
  close: "Close",
};

export const ko = {
  title: "{{schema}}.{{table}} 에 CSV 가져오기",
  readOnlyNotice:
    "미리보기 및 컬럼 매핑. 이 단계는 읽기 전용이며 아직 저장되지 않습니다.",
  chooseFile: "CSV 파일 선택",
  chooseFileAria: "미리 볼 CSV 파일 선택",
  hasHeader: "첫 행을 헤더로 사용",
  hasHeaderAria: "첫 행을 헤더로 처리",
  rowCount: "{{count}}행",
  mappingRegionAria: "컬럼 매핑",
  mappingLabel: "컬럼 매핑 ({{mapped}}/{{total}} 매핑됨)",
  mapColumnAria: "{{column}} 컬럼의 CSV 헤더",
  skipColumn: "— 건너뛰기 —",
  previewRegionAria: "CSV 미리보기",
  previewLabel: "미리보기",
  commitPending: "가져오기는 다음 단계에서 실행됩니다",
  close: "닫기",
};
