# Sprint 202 — Contract

Sprint: `sprint-202` (refactor — `db/postgres.rs` 3803-line monolith 4-way split).
Date: 2026-05-05.
Type: refactor (행동 변경 0; 모듈 재구성).

`docs/PLAN.md` Sprint 203 row (sequencing 한 칸 당김 — 본 cycle 의 frontend
god file 처리 후 backend god file #1 진입). Sprint 197 (`db/mongodb.rs` 1809-line
4-way split) entry-pattern 4 번째 답습. `commands/connection.rs` (1710줄)
는 본 스프린트 OOS — 별도 결정.

## Sprint 안에서 끝낼 단위

- **모듈 구조 신설**: `db/postgres.rs` (entry, modern 2018+ 패턴) +
  `db/postgres/` 하위 디렉토리 4 파일. `postgres.rs` 자체는 3803 → 344 줄
  modification (git --follow 으로 history 연결).
    - `postgres.rs` — 모듈 선언 + `pub use connection::PostgresAdapter` +
      `impl DbAdapter for PostgresAdapter` + `impl RdbAdapter for
      PostgresAdapter` (단일 trait impl block 2 개, 18 method 모두
      inherent 로 thin delegate 또는 `tokio::select!` cancel-token wrap).
    - `connection.rs` — `PostgresAdapter` struct + `PgPoolState` struct +
      `Default` + 라이프사이클 inherent (`new` / `connect_options` / `test` /
      `connect_pool` / `disconnect_pool` / `active_pool` / `switch_active_db` /
      `current_database` / `ping`) + `select_eviction_target` + `PG_SUBPOOL_CAP` +
      `is_pg_database_permission_denied` + connection lifecycle/eviction tests.
    - `schema.rs` — `list_schemas` / `list_tables` / `get_table_columns` /
      `get_table_columns_inner` / `list_schema_columns` / `get_table_indexes` /
      `get_table_constraints` / `list_views` / `list_functions` /
      `get_view_columns` / `get_view_definition` / `get_function_source` /
      `list_databases` + `format_fk_reference` + schema tests.
    - `queries.rs` — `execute` / `execute_query` / `execute_query_batch` /
      `query_table_data` / `stream_table_rows` + `strip_leading_comments` /
      `strip_trailing_terminator` / `pg_cast_type` + query tests.
    - `mutations.rs` — `drop_table` / `rename_table` / `alter_table` /
      `create_index` / `drop_index` / `add_constraint` / `drop_constraint` +
      `validate_identifier` / `quote_identifier` / `qualified_table` +
      mutation tests.
- **trait dispatch 패턴**: 단일 `impl DbAdapter` + `impl RdbAdapter` for
  `PostgresAdapter` 가 `postgres.rs` 에 위치, 각 method 가 `Box::pin(async move
  { ... })` 으로 inherent 호출. cancel-token 처리 (`tokio::select!`) 은
  trait 측에서 1회 wrap; inherent body 자체는 cancel 비인지 (단,
  `execute_query` / `execute_query_batch` / `stream_table_rows` 는 inherent
  안에서 자체 cancel-token 처리).
- **`_impl` rename 미적용 (Sprint 197 과 차이)**: `commands/connection.rs:321`
  의 `PostgresAdapter::test` 직접 호출 + `commands/connection.rs:26` 의
  `PostgresAdapter::new()` + `commands/meta.rs:425/660/674/1052` 의 `::new()`
  외부 caller 가 inherent method 를 직접 호출하므로 (`pub` 유지 필수),
  `_impl` suffix 변환은 외부 API breaking 으로 행동 변경 0 위반. mongodb
  와 다른 점.
- **회귀 0**: 코드 동등성 — `cargo test --lib` 결과 = pre-split (전체
  345 passed / 2 ignored). pre-split 파일의 모든 test 가 분할된 4 파일에
  분산되어 그대로 유지.

## Acceptance Criteria

### AC-202-01 — 단일 3803-line 파일이 5 파일로 분할

- `src-tauri/src/db/postgres.rs` (3803) → 344 줄 modification 으로 축소
  (동일 path 유지로 `git log --follow` 추적 가능).
- `src-tauri/src/db/postgres/{connection, schema, queries, mutations}.rs`
  4 파일 신규.
- 각 파일 < 1300 라인 (mutations.rs 가 가장 큼 1274, schema.rs 841,
  queries.rs 796, connection.rs 651).

### AC-202-02 — `PostgresAdapter` public API 무변화

- `pub use connection::PostgresAdapter` 으로 외부 import 경로 보존.
- 기존 호출자 (`db/mod.rs`, `commands/connection.rs`, `commands/meta.rs`)
  무수정.
- `PostgresAdapter::test` / `::new` 의 inherent `pub async fn` /
  `pub fn` 시그니처 보존 — 외부 caller `commands/connection.rs:321`
  + `commands/meta.rs:425/660/674/1052` 정상 동작.

### AC-202-03 — `impl DbAdapter` / `impl RdbAdapter` 무변화 — trait dispatch shim

- `DbAdapter` 4 trait method (kind / connect / disconnect / ping) +
  `RdbAdapter` 22 trait method 시그니처 동일.
- 각 method body: `Box::pin(async move { self.<x>(...).await })` 또는
  cancel-token wrap. 행동 변경 0.

### AC-202-04 — 테스트 분산 보존

- pre-split postgres.rs 의 test 가 connection.rs (eviction LRU /
  switch_active_db / connect_options / permission_denied / lifecycle) /
  schema.rs (list_schemas / list_views / list_functions / list_databases /
  format_fk_reference) / queries.rs (execute_sql_batch / strip_leading_comments /
  strip_trailing_terminator) / mutations.rs (drop_table / rename_table /
  alter_table / create_index / drop_index / add_constraint /
  drop_constraint / validate_identifier / quote_identifier / qualified_table) 로
  주제별 분산.
- `cargo test --lib` → 345 passed / 2 ignored (baseline 동등).

### AC-202-05 — 가시성 적응

- 외부 caller 호출 메서드 (`new` / `test`): `pub` 유지.
- sub-file cross-reference 메서드 (`active_pool` / `get_table_columns_inner` /
  `qualified_table` / `quote_identifier` / `is_pg_database_permission_denied`):
  `pub(super)` 으로 격상 (기존 private). queries.rs 가 mutations.rs 의
  `qualified_table` 호출, schema.rs 가 connection.rs 의
  `is_pg_database_permission_denied` 호출 — 각각 `use super::mutations::...` /
  `use super::connection::...` 로 import.
- 기타 helper (`select_eviction_target`, `format_fk_reference`):
  `pub(crate)` 그대로 유지 (외부 모듈 import 경로 변화 없음).

## Out of scope

- `commands/connection.rs` (1710줄) 분할 — Phase 25 이후 별도 결정.
- `PostgresAdapter` 동작 변경 / 신규 method / 테스트 추가 — 별도 sprint.
- mongodb 의 `_impl` suffix 패턴 답습 — postgres 의 외부 caller 가 inherent
  를 직접 호출하므로 적용 불가.
- `format_fk_reference` 의 entry 위치 vs schema.rs 위치 결정 — schema.rs
  로 (FK 메타데이터의 wire format 이라 schema introspection 의 부속).

## 검증 명령

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml
pnpm tsc --noEmit
```

기대값: fmt 0 / clippy 0 / lib 345 passed (2 ignored) / build 0 / tsc 0.
frontend 변경 0 — `pnpm vitest run` baseline 유지.
