# Sprint 192 — Contract

Sprint: `sprint-192` (FB-3 — RDB DB-단위 export, 통합 재설계).
Date: 2026-05-02.
Type: feature.

`docs/refactoring-plan.md` FB-3 — DB 단위 export — 의 RDB 갈래. 외부
도구 (`pg_dump` / `mysqldump`) 의존 없이 프로젝트 내부 metadata + PG
server-side cursor 만으로 schema/database dump (DDL + DML) 을 한
`.sql` 파일로 streaming 출력한다.

진입점은 SchemaTree 헤더 Popover 한 곳. schema 단위 / database 단위 ×
DDL / DML / Both 의 6 액션을 trigger 한다. 우클릭 context menu 진입점은
2026-05-02 사용자 피드백으로 폐기 (발견성 ↓ + MySQL/SQLite tree shape
에서 schema 행이 hide 됨).

## Scope 변경 이력 (2026-05-02)

본 sprint 는 진행 중 두 차례 scope 확장:

1. 1차 (DDL only) — schema 단위 migration 만. AC-192-01..04. Out of
   scope: data export, database 단위, Mongo.
2. 2차 (data + database 통합) — 사용자 "묶어서 재설계" 결정. data
   streaming 을 본 sprint 안으로. AC-192-05..07 추가.
3. 3차 (sequence fix) — 사용자 import smoke 에서 `nextval(...)`
   sequence 미생성 발견. AC-192-08 추가 (BIGSERIAL 정규화 + setval).

본문은 최종 (3차) scope 만 기록. 진행 중 결정/리스크는 `findings.md`.

## Sprint 안에서 끝낼 단위

- `generateMigrationDDL` lib pure — DDL 합성. PG `nextval(...)` default
  은 BIGSERIAL/SERIAL/SMALLSERIAL 로 정규화.
- `buildSequenceResets` lib pure — DML 끝에 emit 할 setval 줄 합성.
- `write_text_file_export` Tauri command — DDL-only 시나리오의 단순 IO.
- `RdbAdapter::stream_table_rows` trait method — server-side cursor 기반
  row streaming. PG override + default `Unsupported`.
- `export_schema_dump` Tauri command — DDL header + per-table cursor
  stream + multi-row INSERT formatter + DDL footer (setval).
- `useMigrationExport` hook — 6 액션 (single/all × ddl/dml/both) 의 thin
  orchestrator. metadata 수집 + DDL 합성 + invoke.
- SchemaTree 헤더 Popover — 3 icon (FileText/Rows3/Database) × 2 단위.
  align=start, w-56.
- ExportButton (DataGrid toolbar) 일관성 정리 — icon-only + align=start.

문서 export (Mongo) 는 별 sprint. MySQL/SQLite adapter 는 Phase 9
placeholder — ddlGenerator 의 mysql/sqlite path 는 미래용 dead code.

## Acceptance Criteria

### AC-192-01 — `generateMigrationDDL` lib + sequence 정규화

`src/lib/sql/ddlGenerator.ts`. 14 unit cases:

- AC-192-01-1..8 (1차) — dialect quoting, inline/composite PK, secondary
  index, FK constraint.
- AC-192-09-1..6 (3차) — PG `nextval(...)` default → BIGSERIAL/SERIAL/
  SMALLSERIAL 매핑, NOT NULL/DEFAULT 자동 제거, non-nextval default 보존,
  `buildSequenceResets` 의 setval emit, non-PG dialect noop.

### AC-192-02 — `write_text_file_export` Tauri command

`src-tauri/src/commands/export.rs`. 변경 없음 (1차 그대로). 2 unit.

### AC-192-03 — `useMigrationExport` hook (통합 시그니처)

`src/hooks/useMigrationExport.ts`. 6 action:

```ts
exportSchema(connId, schema, "ddl" | "dml" | "both"): Promise<void>;
exportDatabase(connId, schemas[], "ddl" | "dml" | "both"): Promise<void>;
isExporting: boolean;
```

분기:
- `"ddl"` → `generateMigrationDDL` 합성 → `write_text_file_export`.
- `"dml" | "both"` → metadata + (both 인 경우 DDL header) + setval footer
  → `export_schema_dump` invoke.
- `db_type` 이 mongodb / redis 면 toast.error reject.

### AC-192-04 — SchemaTree 헤더 Popover 진입점

`src/components/schema/SchemaTree.tsx`. trigger = Download icon button
(`size="icon-xs"`, aria-label="Export"). RDB 연결만 노출 (paradigm ===
"rdb"). PopoverContent `align="start"`, `w-56`.

레이아웃:
- multi-schema: `All schemas` 행 + `[FileText/Rows3/Database]` 3 icon →
  `exportDatabase(...)` 호출.
- 구분선.
- `SCHEMAS` 라벨 + schema 행 마다 `[FileText/Rows3/Database]` 3 icon →
  `exportSchema(connId, schema, include)` 호출.

각 icon 의 native `title` 로 의미 명시 (Schema only DDL / Data only DML
/ Full dump). 검증: SchemaTree.test.tsx AC-192-04-1 (PG popover 3 액션
가시성) + AC-192-04-2 (Mongo trigger hide).

### AC-192-05 — `export_schema_dump` Tauri command

`src-tauri/src/commands/export.rs`:

```rust
#[tauri::command]
pub async fn export_schema_dump(
    state: State<'_, AppState>,
    connection_id: String,
    target_path: PathBuf,
    ddl_header: String,
    ddl_footer: String,
    tables: Vec<ExportDumpTable>,
    options: ExportSchemaDumpOptions,  // { include, batch_size }
    export_id: Option<String>,
) -> Result<ExportSummary, AppError>;
```

Flow:
1. `query_tokens` 에 `export_id` 등록.
2. `tokio::fs::File` + `BufWriter` 생성.
3. `include in {ddl, both}` → `ddl_header` write.
4. `include in {dml, both}` → table 별 cursor stream:
   - mpsc channel(2) — sender (`stream_table_rows`) + receiver (drain
     loop) 를 `tokio::try_join!` 로 동시 진행.
   - row 마다 `INSERT INTO "s"."t" (cols) VALUES (...);` 한 줄 emit.
5. `ddl_footer` 비어있지 않으면 setval 섹션 prepend + write.
6. flush + summary. 에러 시 partial file remove.

검증: 9 unit cases — `quote_pg_identifier`, `quote_pg_string`,
`qualified_pg_table`, `pg_value_to_sql_literal` 의 5 variant + array/
object jsonb cast + `ExportInclude` serde lowercase.

### AC-192-06 — `RdbAdapter::stream_table_rows` trait method

`src-tauri/src/db/mod.rs`. default `Unsupported` — Phase 9 합류 시 MySQL/
SQLite override. `PostgresAdapter::stream_table_rows` (db/postgres.rs)
inherent + trait override:

- `BEGIN; DECLARE _vt_export_cur NO SCROLL CURSOR FOR SELECT
  row_to_json(t)::text FROM "s"."t" t; FETCH FORWARD batch_size; …;
  CLOSE; COMMIT`.
- column lookup-by-name (호출자가 source order 의 `column_names` 전달
  — `serde_json::Map` 이 alphabetical 이라도 안전).
- cancel/receiver-drop → CLOSE + ROLLBACK + `Operation cancelled`.

### AC-192-07 — ExportButton (DataGrid toolbar) 일관성

`src/components/shared/ExportButton.tsx`. `size="xs"` + text → `size="icon-xs"`
+ icon-only + `Download size={12}`. PopoverContent `align="end"` →
`align="start"`. test 영향 없음 (aria-label="Export" 그대로).

### AC-192-08 — BIGSERIAL 정규화 + setval reset

PG `bigint NOT NULL DEFAULT nextval('seq'::regclass) PRIMARY KEY` →
`"col" BIGSERIAL PRIMARY KEY`. PG 가 sequence 를 `<table>_<col>_seq`
이름으로 자동 생성하며 원본 sequence 이름 규칙과 일치. DML 끝에:

```sql
SELECT setval(pg_get_serial_sequence('"s"."t"', 'col'),
  COALESCE((SELECT MAX("col") FROM "s"."t"), 1));
```

idempotent — 빈 테이블도 OK. 본 변환의 한계는 `findings.md` 의
"sequence v1 한계" 항목 (START/INCREMENT/CACHE 등 metadata 손실, GENERATED
AS IDENTITY 미지원).

## Out of Scope

- **Mongo migration / data export** — 별 sprint.
- **MySQL/SQLite adapter** — Phase 9. ddlGenerator path 는 dead.
- **Multi-row VALUES batch** — single-row INSERT per line. 가독성 우선.
- **Column-type-aware value cast** — bytea/timestamp/uuid 모두 String
  variant 로 PG implicit cast. column_types 보내는 v2 에 미룸.
- **GENERATED AS IDENTITY column** — `is_identity` flag 가 schemaStore
  에 미반영. 별 sprint.
- **Sequence metadata 보존** — `CREATE SEQUENCE` 명시 emit / OWNED BY
  / START WITH 보존은 별 sprint.
- **Views / functions / sequences DDL** — 별 sprint.
- **Cancellation token UI** — 백엔드는 cancel 가능, 프론트엔드 cancel
  버튼은 미연결.

## 기준 코드 (변경 surface)

- **NEW** `src/lib/sql/ddlGenerator.ts` (~280 줄).
- **NEW** `src/lib/sql/ddlGenerator.test.ts` (14 case).
- **NEW** `src/hooks/useMigrationExport.ts` (~270 줄).
- `src/lib/tauri.ts` — `writeTextFileExport` + `exportSchemaDump` wrapper.
- `src/components/schema/SchemaTree.tsx` — 헤더 Popover (~110 줄).
- `src/components/schema/SchemaTree.test.tsx` — AC-192-04 두 case 갱신.
- `src/components/shared/ExportButton.tsx` — icon-only + align=start.
- `src-tauri/src/commands/export.rs` — `write_text_file_export` +
  `export_schema_dump` + 11 unit case.
- `src-tauri/src/lib.rs` — handler 등록 2건.
- `src-tauri/src/db/mod.rs` — `RdbAdapter::stream_table_rows` default.
- `src-tauri/src/db/postgres.rs` — inherent + trait override.

## Dependencies

- Sprint 191 closure: `useSchemaCache` 가 schema metadata 의 진입을 hook
  단으로 정리.
- Sprint 189 closure: `src/lib/sql/` sub-grouping.

## Refs

- `docs/refactoring-plan.md` FB-3 — DB 단위 export.
- `memory/conventions/refactoring/lib-hook-boundary/memory.md` D-2.
