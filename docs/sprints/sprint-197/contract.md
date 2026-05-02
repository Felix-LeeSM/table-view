# Sprint 197 — Contract

Sprint: `sprint-197` (refactor — `db/mongodb.rs` 1809-line monolith 4-way split).
Date: 2026-05-02.
Type: refactor (행동 변경 0; 모듈 재구성).

`docs/refactoring-plan.md` Sprint 197 row + `docs/refactoring-smells.md`
§9. Sprint 198 (Mongo bulk-write 3 신규 command) 가 단일 mutation 파일에
추가되도록 토대를 마련한다. `db/postgres.rs` (3684줄) 와
`commands/connection.rs` (1710줄) 는 본 스프린트 OOS — Phase 25 이후
별도 결정.

## Sprint 안에서 끝낼 단위

- **모듈 구조 신설**: `db/mongodb.rs` (entry, modern 2018+ 패턴) +
  `db/mongodb/` 하위 디렉토리 4 파일. `mongodb.rs` 자체는 1809 → 198 줄
  modification (git --follow 으로 history 연결).
    - `mongodb.rs` — 모듈 선언 + `pub use connection::MongoAdapter` +
      `impl DocumentAdapter for MongoAdapter` (단일 trait impl block, 9
      method 모두 `_impl` inherent 로 thin delegate).
    - `connection.rs` — `MongoAdapter` struct + `Default` + 라이프사이클
      inherent (`new` / `build_options` / `test` / `current_client` /
      `switch_active_db` / `current_active_db` / `resolved_db_name`) +
      `impl DbAdapter` + connection 관련 tests.
    - `schema.rs` — `_impl` 메서드 (`list_databases_impl` /
      `list_collections_impl` / `infer_collection_fields_impl`) + 헬퍼
      (`infer_columns_from_samples` / `modal_type`) + schema tests.
    - `queries.rs` — `_impl` 메서드 (`find_impl` / `aggregate_impl`) +
      cursor flatten 헬퍼 (`validate_ns` / `bson_type_name` /
      `flatten_cell` / `columns_from_docs` / `project_row`) + queries
      tests.
    - `mutations.rs` — `_impl` 메서드 (`insert_document_impl` /
      `update_document_impl` / `delete_document_impl`) +
      `DocumentId` ↔ `Bson` 헬퍼 (`document_id_to_bson` /
      `bson_id_to_document_id` / `describe_document_id`) + mutation
      tests.
- **trait dispatch 패턴**: 단일 `impl DocumentAdapter for MongoAdapter`
  이 `mongodb.rs` 에 위치, 각 method 가 `Box::pin(async move { ... })`
  으로 `_impl` inherent 호출. cancel-token 처리 (`tokio::select!`) 은
  trait 측에서 1회 wrap; `_impl` body 자체는 cancel 비인지.
- **회귀 0**: 코드 동등성 — `cargo test --lib` 결과 = pre-split (mongodb
  module 만 보면 45 passed / 1 ignored, 전체 338 passed / 2 ignored).
  pre-split 파일의 모든 test 가 분할된 4 파일에 분산되어 그대로 유지.

## Acceptance Criteria

### AC-197-01 — 단일 1809-line 파일이 5 파일로 분할

- `src-tauri/src/db/mongodb.rs` (1809) → 198 줄 modification 으로 축소
  (git diff: -1669 / +58, 동일 path 유지로 `git log --follow` 추적
  가능).
- `src-tauri/src/db/mongodb/{connection, schema, queries, mutations}.rs`
  4 파일 신규.
- 각 파일 < 700 라인 (mongodb.rs 가 가장 작음, connection.rs 가 가장 큼).

### AC-197-02 — `MongoAdapter` public API 무변화

- `pub use connection::MongoAdapter` 으로 외부 import 경로 보존.
- 기존 호출자 (`db/mod.rs`, `commands/document/*`, `commands/meta.rs`)
  무수정.
- `MongoAdapter::test` / `::new` / `::switch_active_db` /
  `::current_active_db` / `::resolved_db_name` 모두 inherent public 으로
  유지.

### AC-197-03 — `impl DocumentAdapter` 무변화 — trait dispatch shim

- 9 trait method 시그니처 동일.
- 각 method body: `Box::pin(async move { self.<x>_impl(...).await })`
  또는 cancel-token wrap. 행동 변경 0.

### AC-197-04 — 테스트 분산 보존

- pre-split mongodb.rs 의 30+ test 가 connection.rs (12 case) /
  schema.rs (8 case) / queries.rs (8 case) / mutations.rs (12 case +
  helpers) 로 주제별 분산.
- `cargo test --lib mongodb` → 45 passed / 1 ignored
  (`test_switch_active_db_happy_path_with_live_mongo`).

### AC-197-05 — Sprint 198 진입 단순화

- `mutations.rs` 가 inherent `impl MongoAdapter { ... _impl }` 블록 +
  헬퍼 가짐. Sprint 198 의 `delete_many` / `update_many` /
  `drop_collection` 3 신규 method 는 본 파일 안에서 (a) 새 `_impl`
  추가, (b) `mongodb.rs` 의 `impl DocumentAdapter` 에 1줄 dispatch
  추가만으로 완료. 다른 파일 미수정.

## Out of scope

- `db/postgres.rs` (3684줄) 분할 — Phase 25 이후 별도 결정.
- `commands/connection.rs` (1710줄) 분할 — 동상.
- `MongoAdapter` 동작 변경 / 신규 method / 테스트 추가 — Sprint 198 에서.
- 5-way 동시 rename — modern entry pattern 으로 mongodb.rs 가 같은
  path 에 198 줄로 남고 (`git log --follow` 가능), 4 신규 파일은 별도
  생성. 동일 효과를 더 단순한 git diff 로 얻음.

## 검증 명령

```sh
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib
cargo test --lib mongodb
```

기대값: fmt 0 / clippy 0 / lib 338 passed (2 ignored) / mongodb 45 passed
(1 ignored). frontend 변경 0 — `pnpm vitest run` baseline 유지.
