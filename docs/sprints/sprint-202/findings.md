# Sprint 202 — Findings

`db/postgres.rs` (3803 lines) → entry (344) + 4 sub-file split. mongodb (Sprint 197)
패턴 답습. 행동 변경 0.

## §0 — 외부 caller 보존 비용

mongodb 와 다른 점: postgres 의 inherent 메서드 일부가 외부 caller 에서
직접 호출됨.

- `commands/connection.rs:321`: `PostgresAdapter::test(&full).await?`
- `commands/connection.rs:26`: `PostgresAdapter::new()`
- `commands/meta.rs:425/660/674/1052`: `PostgresAdapter::new()`

mongodb 는 `_impl` suffix 변환으로 trait dispatch 와 inherent 를 분리했으나,
postgres 에서 같은 변환을 하면 외부 API breaking. 본 sprint 는 inherent
method 의 `pub` 가시성 그대로 유지하고 trait shim 만 entry 에 모았음.

## §1 — 가시성 격상

cross-sub-file 호출이 발생한 helper / inherent method 의 가시성을 `pub(super)`
으로 격상:

| 위치 | 호출자 | 이유 |
|------|--------|------|
| `connection.rs::active_pool` | `queries.rs` (execute, execute_query, query_table_data, stream_table_rows), `schema.rs` (list_schemas, list_tables, get_table_columns_inner, list_schema_columns, get_table_indexes, get_table_constraints, list_views, list_functions, get_view_columns, get_view_definition, get_function_source, list_databases), `mutations.rs` (drop_table, rename_table, alter_table, create_index, drop_index, add_constraint, drop_constraint) | 모든 query path 가 active_pool 을 통과 |
| `connection.rs::is_pg_database_permission_denied` | `schema.rs::list_databases` | row-level permission probe |
| `schema.rs::get_table_columns_inner` | `queries.rs::query_table_data` | column metadata 우회 (double-lock 회피) |
| `mutations.rs::quote_identifier` | (mutations.rs 내부 only) | DDL identifier 인용 |
| `mutations.rs::qualified_table` | `queries.rs::stream_table_rows` | server-side cursor SQL 빌드 |

`select_eviction_target` (LRU helper), `format_fk_reference` (FK wire format)
는 기존 `pub(crate)` 그대로 — 외부 모듈 import 가 발생할 수 있어 보존.

## §2 — Helper 위치 결정

각 free helper 의 sub-file 배정 — 호출자가 단일 sub-file 인 경우 그곳에:

- `strip_leading_comments` / `strip_trailing_terminator` → queries.rs (모두
  `execute_query` / `execute_query_batch` 만 호출)
- `pg_cast_type` → queries.rs (`query_table_data` 의 column casting)
- `validate_identifier` → mutations.rs (DDL 7 method 만 호출)
- `quote_identifier` → mutations.rs (단, `qualified_table` 도 같이 — 내부 호출)
- `qualified_table` → mutations.rs (대다수 caller mutations, 1 caller queries)
- `format_fk_reference` → schema.rs (`get_table_columns_inner` /
  `list_schema_columns` 의 FK 렌더링)
- `select_eviction_target` / `PG_SUBPOOL_CAP` → connection.rs (LRU 자체)
- `is_pg_database_permission_denied` → connection.rs (사실상 schema 의
  `list_databases` 만 호출 but error type 매처라 connection 류로 분류,
  permission_denied tests 도 같이)

## §3 — 테스트 분산

원본 1410-line `mod tests` 를 4 sub-file 의 `mod tests` 로 분산. 각
sub-file mod tests 는 `use super::*;` + 자체 helper (sample_config /
StubDbError + make_db_error / Sample + Fixture).

**connection.rs tests** (~270 lines):
- sample_config helper
- new_adapter_has_no_pool, ping_without_connection_fails
- test_switch_active_db (returns_err / rejects_empty / cache_hit / evicts_oldest /
  protects_current / cache_miss [#ignored])
- test_select_eviction_target (protects / picks_oldest / skips_current)
- connect_options_builder
- StubDbError + make_db_error helpers
- permission_denied (sqlstate / message / case_insensitive / does_not_match — 8 tests)

**schema.rs tests** (~150 lines):
- list_schemas_without_connection_fails
- list_views / list_functions / get_view_columns / get_view_definition /
  get_function_source — 5 connection-error tests
- format_fk_reference (happy / underscored / special_chars — 3 tests)
- list_databases_without_connection_fails
- format_fk_reference_matches_sprint_88_fixture (fixture round-trip)

**queries.rs tests** (~120 lines):
- test_execute_sql_batch (empty / validation_rejects_empty)
- strip_leading_comments (line / block / multiple / mixed / no_comment / only_comment /
  unclosed_block / whitespace_only — 8 tests)
- strip_trailing_terminator (single / whitespace / multiple / no_change / preserves_internal /
  only_semicolons — 6 tests)

**mutations.rs tests** (~800 lines, 가장 큼):
- drop_table_without_connection_fails
- rename_table (without / empty / whitespace / invalid_chars / starts_with_digit / valid)
- validate_identifier (valid / empty / whitespace / digit / special_chars / space)
- quote_identifier (simple / embedded_quote)
- qualified_table_format
- alter_table preview (only / add_with_default / modify / drop / batch / empty / invalid_table /
  invalid_column / without_connection — 9 tests)
- create_index preview (btree / hash / multi_column / all_types / invalid_type / empty_columns /
  invalid_name / without_connection — 8 tests)
- drop_index preview (basic / if_exists / invalid_name / without_connection — 4 tests)
- add_constraint preview (primary_key / foreign_key / unique / check / empty_pk / empty_check /
  invalid_name / without_connection — 8 tests)
- drop_constraint preview (basic / invalid_name / without_connection — 3 tests)

## §4 — Boundary 정밀 추출

3803-line monolith 의 메서드 별 line range 를 awk 로 정확히 매핑한 후 sed
chunk 추출 → impl block / mod tests wrapper 자동 부착. 첫 시도 (sed
range 가 다음 메서드 의 doc comment 까지 spillover) 후 awk 검증으로 4
boundary 재조정:

| 위치 | 1차 | 2차 (수정) | 사유 |
|------|-----|-----------|------|
| connection methods | 196,421 | 196,419 | 421 = `execute` doc 시작 |
| queries query_table_data | 1229,1334 | 1229,1331 | 1333-1334 = `drop_table` doc |
| schema get_table_constraints..list_databases | 1738,2069 | 1738,2060 | 2061+ = impl close + `is_pg` doc |
| connection is_pg helper | 2071,2097 | 2071,2086 | 2087+ = trait shim divider comment |
| queries+mutations tests | 2756,3561 | 2756,3558 | 3559+ = list_views section |

awk 로 `}` close vs 다음 메서드 doc 시작 line 확정 후 chunk range 동결.

## §5 — Build 검증

| 항목 | 결과 |
|------|------|
| `cargo fmt -- --check` | exit 0 |
| `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 |
| `cargo test --lib` | 345 passed / 2 ignored (baseline 동등) |
| `cargo build` | exit 0 |
| `pnpm tsc --noEmit` | exit 0 |

frontend 변경 0 (Rust-only refactor).

## §6 — 라인 수 변화

| 파일 | 신규 | 비고 |
|------|------|------|
| `db/postgres.rs` | 344 | trait shim + mod 선언 + module-level doc |
| `db/postgres/connection.rs` | 651 | struct + 라이프사이클 9 method + LRU + permission helper + tests |
| `db/postgres/queries.rs` | 796 | 5 query method + 3 SQL normalization helpers + tests |
| `db/postgres/schema.rs` | 841 | 13 schema method + format_fk_reference + tests |
| `db/postgres/mutations.rs` | 1274 | 7 DDL method + 3 identifier helpers + extensive preview tests |
| **합계** | **3906** | 원본 3803 + 103 (4 file headers + impl block wrappers + extra mod tests boilerplate) |

mongodb 의 split 효율 (1809 → 198 + 4 sub-files): postgres 가 `_impl`
변환 안 한 결과 entry 가 mongodb 의 198 보다 큰 344 (trait shim 영역
2103-2391 = 289 lines 가 entry 에 그대로 잔존).

## §7 — Out-of-scope deferred

- `commands/connection.rs` (1710 lines) 분할 — 본 cycle 의 다음 backend
  god file. `tabStore.ts` (1002) 처리 후 cycle 종료 시점에 재평가.
- `format_fk_reference` 의 wire format quote/escape — Sprint 89 scope 였고
  본 sprint 에서도 OOS.
- mongodb-style `_impl` suffix rename — 외부 API breaking 이라 본 sprint
  에서는 적용 불가. 향후 `commands/*` 의 callsite 통합 sprint 에서 재평가.
