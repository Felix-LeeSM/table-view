# Sprint 63 Contract — Phase 6 Trait 계층 설계 + PostgresAdapter 위임 impl (plan A1)

> Phase 6 플랜 [`A1`](/Users/felix/.claude/plans/zany-hugging-twilight.md)에 해당. 후속은 Sprint 64(A2), 65(B), 66(C), 67(D), 68(E), 69(F).

## Scope
Phase 6 플랜의 **A1 항목**에 해당하는 것만 다룬다:
- `src-tauri/src/db/mod.rs`에 paradigm별 trait 계층, 공통 DTO, `ActiveAdapter` enum을 선언
- 기존 `PostgresAdapter`가 `RdbAdapter`를 impl (concrete 메서드로 위임)
- AppState, command 계층, frontend는 **건드리지 않음** (Sprint 64/A2로 분리)

## Done Criteria
Generator/Evaluator 모두 다음을 만족해야 Sprint 63 DONE:

1. `src-tauri/src/db/mod.rs`가 다음을 공개한다:
   - 기존 `DbAdapter` trait 그대로 유지 (connect/disconnect/ping + kind)
   - `RdbAdapter: DbAdapter` trait (필수: namespace_label, list_namespaces, list_tables, get_columns, execute_sql, query_table_data, drop_table, rename_table, alter_table, create_index, drop_index, add_constraint, drop_constraint, list_views/list_functions는 default 빈 구현, get_view_definition/get_function_source 포함)
   - `DocumentAdapter: DbAdapter` trait (시그니처만: list_databases, list_collections, infer_collection_fields, find, aggregate, insert_document, update_document, delete_document)
   - `SearchAdapter: DbAdapter`, `KvAdapter: DbAdapter` — Phase 7/8 placeholder로 **빈 trait 선언**만 (method 없음)
   - DTO: `NamespaceLabel`, `NamespaceInfo`, `FindBody`, `DocumentQueryResult`, `DocumentId`, `RdbQueryResult`
   - `ActiveAdapter` enum: `Rdb/Document/Search/Kv` variants + accessor `kind()`, `lifecycle()`, `as_rdb()`, `as_document()`, `as_search()`, `as_kv()` (후자는 `Result<&dyn _, AppError>` 반환)

2. `src-tauri/src/db/postgres.rs`에 `impl RdbAdapter for PostgresAdapter` 블록 추가. 각 메서드는 **기존 concrete 메서드를 호출하는 얇은 delegate**. `list_schemas` → `list_namespaces`로 매핑. `namespace_label()`은 `NamespaceLabel::Schema` 반환.

3. 기존 `PostgresAdapter`의 concrete inherent 메서드는 **하나도 삭제/시그니처 변경 금지** (A2에서 정리 예정).

4. AppState, commands, frontend, tests 파일은 수정하지 않는다.

5. 검증:
   - `cd src-tauri && cargo fmt --check` 통과
   - `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` 통과
   - `cd src-tauri && cargo test --lib` 통과
   - `cd src-tauri && cargo test --test schema_integration --test query_integration` 통과 (DB 없으면 SKIP 메시지로 자연 종료)
   - `pnpm tsc --noEmit` 통과
   - `pnpm lint` 통과
   - `pnpm vitest run` 통과

## Out of Scope
- AppState의 `active_connections` 타입 변경 (Sprint 64/A2)
- factory 함수 / command 리팩터 (Sprint 64/A2)
- MongoAdapter, MySQL/SQLite adapter 신규 구현 (Sprint 65+)
- frontend 변경
- 기존 concrete 메서드 이름 변경 또는 제거

## Invariants
- Postgres 통합 테스트(존재 시) 회귀 0
- `pnpm tauri dev` 실행 시 기존 Postgres 워크플로우 동작 불변 (수동 smoke는 Sprint 64/A2에서 수행)
- 외부 프론트엔드 API(Tauri invoke 명령 이름, payload shape) 불변

## Verification Plan
- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib`
  4. `pnpm tsc --noEmit`
  5. `pnpm lint`
  6. `pnpm vitest run`
- Required evidence:
  - Generator: 수정·추가된 파일 목록 + 각 command의 실제 출력 요약 (stdout 마지막 20줄 또는 전체 성공 여부)
  - Evaluator: `db/mod.rs`에서 각 trait/DTO/enum 실재 확인, `postgres.rs` 하단의 `impl RdbAdapter` 블록 확인, 기존 concrete 메서드가 남아있는지 grep으로 확인
