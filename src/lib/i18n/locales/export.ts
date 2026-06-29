/**
 * `export` 네임스페이스 — 데이터/스키마 내보내기 흐름 toast 문자열
 * (useMigrationExport, runtime/export). en 값은 마이그레이션 이전 하드코딩
 * 영어 리터럴을 바이트 그대로 미러한다.
 *
 * ponytail: 다중 count(스키마/테이블/행)·toLocaleString 포맷 때문에 성공 toast 의
 * 괄호 detail 은 호출처 JS 에서 조립해 `{{detail}}` 로 주입한다 — i18next 단일
 * `count` 복수형으로는 재현 불가. ko 는 숫자형 detail 을 그대로 노출(한국어는
 * 명사 복수 구분이 없어 의미 손실 없음).
 */

export const en = {
  includeLabel: {
    ddl: "Schema (DDL)",
    dml: "Data (INSERT)",
    both: "Full dump (DDL + data)",
  },
  connectionNotFound: "Export: connection not found",
  unsupportedDbType: "Export: {{dbType}} is not yet supported (RDB only)",
  schemaNoTables: 'Export: schema "{{schema}}" has no tables',
  noSchemas: "Export: no schemas to export",
  databaseNoTables: "Export: database has no tables",
  tableMetadataNotFound:
    'Export: table "{{schema}}.{{table}}" 의 metadata 를 찾을 수 없음',
  failed: "Export failed: {{message}}",
  exported: "Exported {{label}} ({{detail}})",
  gridRowsExported_one: "Exported {{formatted}} row",
  gridRowsExported_other: "Exported {{formatted}} rows",
} as const;

export const ko = {
  includeLabel: {
    ddl: "스키마 (DDL)",
    dml: "데이터 (INSERT)",
    both: "전체 덤프 (DDL + 데이터)",
  },
  connectionNotFound: "내보내기: 연결을 찾을 수 없습니다",
  unsupportedDbType:
    "내보내기: {{dbType}}은(는) 아직 지원되지 않습니다 (RDB 전용)",
  schemaNoTables: '내보내기: 스키마 "{{schema}}"에 테이블이 없습니다',
  noSchemas: "내보내기: 내보낼 스키마가 없습니다",
  databaseNoTables: "내보내기: 데이터베이스에 테이블이 없습니다",
  tableMetadataNotFound:
    '내보내기: 테이블 "{{schema}}.{{table}}"의 메타데이터를 찾을 수 없습니다',
  failed: "내보내기 실패: {{message}}",
  exported: "{{label}} 내보냄 ({{detail}})",
  gridRowsExported_one: "{{formatted}}행 내보냄",
  gridRowsExported_other: "{{formatted}}행 내보냄",
} as const;
