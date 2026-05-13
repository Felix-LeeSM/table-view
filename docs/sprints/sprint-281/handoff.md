# Sprint 281 — MySQL Slice A (read path + UI surface)

**날짜**: 2026-05-13
**범위**: MySQL 어댑터 RdbAdapter trait wire-up (read path) + factory arm
활성화 + UI/fixture mysql 노출. Phase 17 본체의 첫 슬라이스.

## 변경

### Backend — `src-tauri/src/db/mysql/`

- **신규** `mysql/schema.rs` — `list_schemas` / `list_tables` /
  `get_table_columns` inherent method 3종 + `map_mysql_data_type` /
  `format_fk_reference` helper. PG `schema.rs` 의 책무 분할 답습.
  - `information_schema.schemata` 에서 시스템 schema 4종
    (`information_schema`, `mysql`, `performance_schema`, `sys`) 필터.
  - `information_schema.tables` → `BASE TABLE` 만, `table_rows` 를
    approximate row count 로 사용 (PG `n_live_tup` 와 동일 위상).
  - `information_schema.columns` 의 `column_type` (`varchar(200)` 형식)
    을 그대로 사용해 PG `format_type` 등가. `data_type` 은 category
    매핑용 (length/precision 없는 keyword).
  - PK / FK 별도 round-trip (`table_constraints` + `key_column_usage`).
  - CHECK constraint 은 Slice E (Sprint 285) 로 deferred — Slice A 는
    `check_clauses: Vec::new()` 로 통과.

- **변경** `mysql.rs` — `RdbAdapter` trait 본격 impl. 21+ method 중:
  - **구현 4종** — `namespace_label`, `list_namespaces`, `list_tables`,
    `get_columns` (PG 의 cancel-token race 패턴 답습).
  - **Slice B~G 예약 stub** — `execute_sql` / `query_table_data` /
    DDL 6 / index/constraint CRUD / views / functions 등 `unsupported_slice("Slice X", "op")`
    로 friendly reject. 사용자 surface 에선 "MySQL adapter: <op> is not
    yet implemented (Phase 17 Slice <X>)" 메시지로 표면.
  - **빈 결과 graceful degrade** — `get_table_indexes` /
    `get_table_constraints` / `list_views` / `list_functions` /
    `list_schema_columns` 는 `Ok(empty)` — table inspector 가 깨지지
    않게.
  - `namespace_label = NamespaceLabel::Database` — frontend sidebar
    그룹 라벨이 'Database' 로 렌더 (PG 의 'Schema' 와 분기).

- **변경** `commands/connection.rs` — `make_adapter` mysql arm 활성화
  (`DatabaseType::Mysql => Ok(ActiveAdapter::Rdb(...))`). 기존
  `test_make_adapter_mysql_returns_unsupported` 테스트를
  `test_make_adapter_mysql_returns_rdb_variant` 로 갱신.

### Frontend — `src/types/connection.ts`

- `SUPPORTED_DATABASE_TYPES` 에 `"mysql"` 추가. `ConnectionDialog` Select
  dropdown / URL parser / paste detect 가 자동으로 mysql 을 supported
  로 인식.
- Sprint 276 의 회귀 가드 테스트 3종 갱신:
  - `connection.test.ts` `SUPPORTED_DATABASE_TYPES` describe → MySQL
    포함 expect.
  - `ConnectionDialog.test.tsx` `DBMS dropdown exposes only supported
    adapters` → MySQL option 도 noexist 가 아니라 exist.
  - `ConnectionDialog.test.tsx` `rejects unsupported %s URL` → mysql
    케이스 제거 (sqlite/redis 만 남김).
  - `ConnectionDialog.urlInput.test.tsx` `[Sprint 276] unsupported
    DBMS paste is silent` → mysql/mariadb 케이스 제거.

### Fixture — `fixtures/profiles/*.yaml` + `scripts/fixtures/`

- `development.yaml` + `e2e.yaml` `database.mysql` 추가 + `connections.mysql`
  fixture connection 1개 추가 (id `fixture-dev-mysql` / `fixture-e2e-mysql`).
- `scripts/fixtures/spec.ts ProfileSpecSchema` 확장 — `database.mysql`
  optional + `connections.mysql` optional. yaml 미지정 시 buildConnections
  는 mysql 항목 skip.
- `scripts/fixtures/connections.ts buildConnections` mysql 분기 추가.
  `database.mysql` fallback = `database.pg` (시각적 일관성, MySQL
  database = schema 라 별도 분리 이유 없음).

## 검증

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib mysql
# → 10 passed (schema map / fk format / connection lifecycle / kind / namespace_label / slice msg / factory)

cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
# → clean

pnpm vitest run
# → 3283 passed | 10 skipped

pnpm tsc --noEmit / pnpm lint  # → clean

pnpm db:up
# → mysql ready.

pnpm db:connections upsert development
# → added=1, updated=2  (mysql fixture connection storage 에 영속)
```

## 사용자 가시 효과

1. 새 connection 생성 dialog → DBMS Select 에 MySQL 노출.
2. `mysql://...` URL paste → `Detected mysql URL — fields populated.`
3. `pnpm db:connections upsert development` → sidebar 의 Fixtures 그룹에
   `Dev (MySQL)` 항목 렌더.
4. mysql connection Connect → schema tree → database 목록 → table 목록 →
   column 목록 (PK/FK/nullable/default/comment) 까지 동작.
5. Query editor 에서 SELECT 실행 / DDL 실행 → `MySQL adapter: <op> is not
   yet implemented (Phase 17 Slice <X>)` friendly reject.

## 후속

- **Sprint 282 (Slice B)** — `execute_sql` + `query_table_data`. query
  editor SELECT/UPDATE 실행 + table view paged rows.
- **Sprint 283 (Slice C)** — `stream_table_rows` (대용량 dump).
- **Sprint 284 (Slice D)** — DDL (`create_table` / `drop_table` /
  `alter_table` / `add_column` / `drop_column` / `rename_table`).
- **Sprint 285 (Slice E)** — index / constraint CRUD + introspection
  (`get_table_indexes` / `get_table_constraints` 실 구현 + CHECK
  constraint per-column 매핑).
- **Sprint 286 (Slice F)** — views / functions / triggers.
- **Sprint 287 (Slice G)** — DB-level (sub-pool LRU cache for `USE <db>`
  switching, `list_schema_columns`, `count_null_rows`).
