# Sprint 192 — Handoff

Date: 2026-05-02. Status: closed.

## 어디까지 했나

- RDB schema/database export 진입점 1 곳 (SchemaTree 헤더 Popover) +
  6 액션 (single/all × DDL/DML/Both) 완성.
- Backend `export_schema_dump` Tauri command + PG server-side cursor
  streaming + multi-row dispatch via `tokio::try_join!`.
- `RdbAdapter::stream_table_rows` trait method 신규 (default `Unsupported`,
  PG override).
- ddlGenerator BIGSERIAL/SERIAL/SMALLSERIAL 정규화 + setval reset.
- DataGrid ExportButton 일관성 정리 (icon-only + align=start).

## 검증 명령

```
pnpm tsc --noEmit
pnpm lint
pnpm vitest run                           # 2679 passed
cargo test --manifest-path src-tauri/Cargo.toml --lib  # 338 passed
cargo clippy --manifest-path src-tauri/Cargo.toml \
  --all-targets --all-features -- -D warnings
```

real PG smoke (사용자 수행) — payment_accounts 같은 sequence 의존
테이블 `Full dump` round-trip 성공.

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- Backend handler: `commands::export::export_schema_dump`
  ([src-tauri/src/lib.rs:157](../../src-tauri/src/lib.rs)).
- Trait method: `RdbAdapter::stream_table_rows`
  ([src-tauri/src/db/mod.rs:289](../../src-tauri/src/db/mod.rs)) — Phase
  9 의 MySQL/SQLite adapter 합류 시 default `Unsupported` 만 override.
- TS wrapper: `exportSchemaDump`
  ([src/lib/tauri.ts:572](../../src/lib/tauri.ts)).
- Hook: `useMigrationExport`
  ([src/hooks/useMigrationExport.ts](../../src/hooks/useMigrationExport.ts))
  — `exportSchema(connId, schema, include)` / `exportDatabase(connId,
  schemas[], include)`.
- DDL helpers: `generateMigrationDDL` + `buildSequenceResets`
  ([src/lib/sql/ddlGenerator.ts](../../src/lib/sql/ddlGenerator.ts)).

### 한계 / 후속 작업 후보

`findings.md` §3.3 + §4 의 deferred risk:
- `CREATE SEQUENCE` 명시 emit (start/increment/cache/owned_by 보존).
- `GENERATED AS IDENTITY` column 지원 — schemaStore 에 `is_identity`
  flag 추가.
- `active_connections` lock-held 단점 — `ActiveAdapter` Arc 화 별 sprint.
- Column-type-aware value cast (bytea/timestamp/uuid 명시 cast).
- Multi-row VALUES batch — 큰 dump 의 restore 속도.
- Mongo schema/database dump — BSON Extended JSON shape 별 sprint.
- Cancel UI — backend 는 cancel 가능, 프론트 cancel 버튼 미연결.

### 회귀 가드

- `src/lib/sql/ddlGenerator.test.ts` (14 case) — dialect quoting / PK /
  index / FK / BIGSERIAL 정규화 / setval.
- `src/components/schema/SchemaTree.test.tsx` AC-192-04-1, AC-192-04-2
  — 헤더 Popover trigger 의 RDB-only 가시성 + 3 액션 노출.
- `src-tauri/src/commands/export.rs` (11 case in `tests` module) — PG
  identifier/string/value escape + ExportInclude serde wire.

### 외부 도구 의존성

없음. `pg_dump` / `mysqldump` 등 외부 binary 미사용. PG 전용 SQL
(`row_to_json`, `pg_get_serial_sequence`, `DECLARE CURSOR`) 만 발사.

## 폐기된 surface

- 기존 SchemaTree schema-row context menu 의 "Export migration..." 항목
  (1차 contract AC-192-04 의 진입점) — 헤더 Popover 로 이전.
- `useMigrationExport.exportSchema` (1차 시그니처) — 새 시그니처
  `exportSchema(connId, schema, include)` 로 교체.

## Refs

- `docs/sprints/sprint-192/contract.md` — 최종 (3차) scope.
- `docs/sprints/sprint-192/findings.md` — 결정 / 한계 / 검증 결과.
- `docs/refactoring-plan.md` FB-3.
