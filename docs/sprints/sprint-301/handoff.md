# Sprint 301 — Handoff

## 상태: PASS

## 인도물

- `src/hooks/useMigrationExport.ts` — `exportTable(connectionId, database,
  schema, table, include)` 메서드 신규. 기존 `exportSchema` 와 같은
  resolveDialect / loadSchemaMetadata / save 흐름을 재사용하되, 단일 table
  의 metadata 만 추려 `generateMigrationDDL` + `exportSchemaDump` 를
  호출. 파일명 기본값은 `{schema}.{table}.{suffix}` (suffix 는 include
  별로 schema.sql / data.sql / dump.sql).
- `src/components/schema/SchemaTree/useSchemaTreeActions.ts` —
  `handleExportSchema(schemaName, include)` / `handleExportTable(tableName,
  schemaName, include)` 핸들러 신규. 내부적으로 useMigrationExport 의
  exportSchema / exportTable 을 wire. `workspaceKeyRef.current` 로 현재
  (connId, db) 를 해석.
- `src/components/schema/SchemaTree/rows.tsx`:
  - `EXPORT_MODES` 상수 — DDL / DML / Full 3 모드 + 라벨 + 아이콘.
  - `renderSchemaRow` 의 컨텍스트 메뉴에 `Export Schema…` sub-menu 추가
    (Create Table 과 Refresh 사이).
  - `renderItemRow` (isTableItem) 의 컨텍스트 메뉴에 `Export Table…`
    sub-menu 추가 (Data 와 Rename 사이).
- `src/components/schema/SchemaTree.tsx` — `ctx` 빌드 시 두 새 핸들러
  wire (`handleExportSchema`, `handleExportTable`).
- `src/components/schema/SchemaTree.actions.test.tsx` — Sprint 301 회귀
  가드 2 it:
  - AC-301-01: schema row 우클릭 시 `Export Schema…` sub-trigger 노출
  - AC-301-02: table row 우클릭 시 `Export Table…` sub-trigger 노출

## 회귀 가드

- vitest: 3354 passed | 10 skipped (Sprint 295 baseline 대비 +4 — Sprint
  299 collapse 3 it + Sprint 301 entry 2 it - Sprint 290 collapse 3 it
  제거.)
- tsc clean
- eslint clean

## 정책 결정

- Sub-menu 항목 구성은 헤더 Download Popover 와 동일 — 같은 use case 의
  중복 진입점이고 사용자 mental model 일관성 유지. Popover (icon driven)
  vs context menu (우클릭 driven) 의 진입점만 다름.
- Driver 별 disabled 처리는 본 sprint 에서 보류. `useMigrationExport.
  exportTable` 이 비-PG 에서 dml / both 호출 시 stream_table_rows 가
  Unsupported 로 응답하면 toast 가 에러를 surfaces 한다. UI 의 disabled
  + tooltip 은 follow-up 후보.
- Sub-menu 의 sub-content 내부 항목 클릭 트리거는 Radix Portal + jsdom
  한계로 unit 가드에서 제외. SubTrigger 노출만 가드 — 메뉴가 통째로
  사라지는 회귀를 잡는다.

## 사용자 요청 원본 인용

> 추가로, table의 context menu에 export table이 있으면 좋을 것 같다.
> schema의 경우도 마찬가지야.

## 후속 후보

- driver 별 Data / Full 항목 disabled + tooltip (MySQL / SQLite stream
  미지원 surfaces).
- Sub-content 내부 항목 클릭 동작의 e2e 가드 (jsdom 미신뢰 영역).
- useMigrationExport.exportTable 의 단위 테스트.
