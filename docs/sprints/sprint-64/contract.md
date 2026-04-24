# Sprint 64 Contract — Phase 6 AppState/command 리팩터 (plan A2)

> Phase 6 플랜 [`A2`](/Users/felix/.claude/plans/zany-hugging-twilight.md)에 해당. 선행 Sprint 63(trait 계층 선언) 기반 위에 AppState/command 계층을 enum dispatch로 전환한다. 동작(behavior) 변화 0.

## Scope
1. `AppState.active_connections`를 `Mutex<HashMap<String, ActiveAdapter>>`로 전환.
2. `commands/connection.rs`에 `make_adapter(db_type) -> Result<ActiveAdapter, AppError>` factory 도입. 현재는 `Postgresql`만 `ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))`; 그 외는 `AppError::Unsupported`.
3. 모든 기존 Tauri command가 `state.active_connections.get(&id)?.as_rdb()?.method(...)` 패턴으로 동작하도록 수정.
4. 기존 `commands/schema.rs` + `commands/query.rs`를 `commands/rdb/{schema,query,ddl}.rs`로 재조직.
5. `lib.rs`의 `invoke_handler` 등록 경로 갱신 (command **이름은 유지**).
6. `ConnectionConfig` 및 `ConnectionConfigPublic` 응답에 `paradigm: "rdb" | "document" | "search" | "kv"` 필드 추가 (backend 태그 + serialize).
7. Frontend `src/types/connection.ts`에 `Paradigm` 타입 도입(아직 UI 분기에는 사용하지 않음).

## Done Criteria
Generator/Evaluator 모두 다음을 만족해야 Sprint 64 DONE:

1. **AppState enum dispatch**: `commands/connection.rs` 또는 적절한 모듈에 `AppState { active_connections: Mutex<HashMap<String, ActiveAdapter>>, … }`. `PostgresAdapter`를 직접 들고 있는 필드는 더 이상 없다.
2. **Factory**: `pub(crate) fn make_adapter(db_type: &DatabaseType) -> Result<ActiveAdapter, AppError>` 존재. 지원되지 않는 타입은 `AppError::Unsupported`.
3. **AppError::Unsupported**: `error.rs`에 `#[error("Unsupported operation: {0}")] Unsupported(String)` variant 추가. `ActiveAdapter::as_rdb/as_document/as_search/as_kv` 네 곳을 `Validation` → `Unsupported`로 치환. 단위 테스트 1건 이상으로 paradigm mismatch가 `Unsupported`로 분류되는지 검증.
4. **Command 재조직**: 다음 파일이 존재하고 기존 command가 모두 옮겨져 있다.
   - `commands/rdb/mod.rs` (`pub mod schema; pub mod query; pub mod ddl;`)
   - `commands/rdb/schema.rs` — list_schemas/list_tables/get_table_columns/list_schema_columns/get_table_indexes/get_table_constraints/list_views/list_functions/get_view_definition/get_view_columns/get_function_source
   - `commands/rdb/query.rs` — execute_query/cancel_query/query_table_data
   - `commands/rdb/ddl.rs` — drop_table/rename_table/alter_table/create_index/drop_index/add_constraint/drop_constraint
   - 각 command 함수는 `ActiveAdapter::as_rdb()?.method(...)` 호출 패턴.
5. **Invoke handler 경로 갱신, 이름 불변**: `lib.rs`가 `commands::rdb::schema::list_schemas` 식으로 참조하되 `tauri::generate_handler!`의 command 이름은 Sprint 63 이전과 **동일**. 프론트엔드 `invoke("list_schemas", …)` 호출이 수정 없이 동작.
6. **`paradigm` 필드 직렬화**: `ConnectionConfigPublic` 또는 해당 응답 타입에 `paradigm: &'static str` (또는 enum)이 포함되어 `serde_json`으로 `"rdb"` 문자열이 실제로 payload에 나타난다. `PostgresAdapter` 계열은 `"rdb"` 반환.
7. **Frontend `Paradigm` 타입**: `src/types/connection.ts`에 `export type Paradigm = "rdb" | "document" | "search" | "kv";` 추가 + 관련 Connection 타입이 `paradigm: Paradigm` 필드 보유. UI 분기는 이번 sprint에 추가하지 않는다(Sprint 65+).
8. **Sprint 63 이월 피드백 정리**:
   - `NamespaceInfo::from(SchemaInfo)` 단위 테스트 1건 이상.
   - `BoxFuture` alias를 trait 시그니처에서 일관되게 사용하거나 제거 (둘 중 하나로 일관되게).
   - `src-tauri/src/db/mod.rs`의 `#[allow(dead_code)]` **0개** (grep 결과 empty).
9. **회귀 0**:
   - `cd src-tauri && cargo fmt --all -- --check` 통과
   - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` 통과
   - `cd src-tauri && cargo test --lib` 통과
   - `cd src-tauri && cargo test --test schema_integration --test query_integration` 통과 (DB 가용 시)
   - `pnpm tsc --noEmit` 통과
   - `pnpm lint` 통과
   - `pnpm vitest run` 통과

## Out of Scope
- MongoAdapter/MySQL/SQLite adapter 구현 (Sprint 65+).
- 실제 `commands/document/*` 신규 파일 (Sprint 65+).
- 프론트엔드에서 `paradigm` 값으로 UI를 분기하는 것.
- `FilterSpec`/`SortSpec` 같은 요청 타입 추상화.
- 기존 command 이름 변경 또는 payload shape 변경.
- 기존 Postgres 동작 변경 (순수 리팩터).

## Invariants
- 프론트엔드 `invoke(...)` 호출 사이트는 **수정 금지**.
- Tauri command의 payload/response shape 불변 (단, `ConnectionConfigPublic`에 `paradigm` 필드가 추가되는 것은 허용 — optional consumer).
- 통합 테스트 회귀 0.
- `PostgresAdapter`의 concrete inherent 메서드 시그니처 불변 (Sprint 63 invariant 유지).

## Verification Plan
- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `cd src-tauri && cargo test --test schema_integration --test query_integration`
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
  7. `pnpm vitest run`
  8. `grep -n '#\[allow(dead_code)\]' src-tauri/src/db/mod.rs` → 결과 0줄
  9. `grep -rn 'commands::schema::\|commands::query::' src-tauri/src/lib.rs` → 결과 0줄 (모두 `commands::rdb::…`로 이동)
- Required evidence:
  - Generator: 변경/이동된 파일 목록, 각 verification command 결과, `paradigm` 직렬화 예시(텍스트), AppState 타입 변경 지점의 전후 스니펫.
  - Evaluator: 위 9개 check 직접 실행 + ActiveAdapter enum dispatch가 실제로 쓰이는지 grep(`as_rdb`) 확인 + `git diff --stat`로 허용 범위 내 변경 확인.
