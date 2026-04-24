# Sprint Contract: sprint-72 (Phase 6 plan E-1 — Backend aggregate + execute_mongo_query command)

## Summary

- Goal: `MongoAdapter::aggregate` 의 `Unsupported` 스텁을 실제 aggregate cursor 실행으로 교체하고, `commands/document/query.rs` 에 `aggregate_documents` Tauri 커맨드를 추가해 프런트가 호출할 엔드포인트를 마련한다.
- Audience: Sprint 73 (Frontend Find/Aggregate UI) 가 이 커맨드를 호출한다. 백엔드가 먼저 안정화되어야 Sprint 73 가 UI 에만 집중할 수 있음.
- Owner: Sprint 72 harness generator.
- Verification Profile: `command` (cargo fmt + clippy + mongodb-scope unit tests + mongo_integration + frontend tsc/lint 로 Frontend diff 0 증명).

Phase 6 master plan 의 Sprint E 가 backend + frontend 합산 대규모라 Sprint 70 과 동일 패턴으로 쪼갬. E-1 = 이 스프린트, E-2 = Sprint 73. Sprint 74~79 는 다른 agent 의 UX Hardening 이 선점했으므로, Phase 6 Sprint F (인라인 편집) 는 Sprint 80 으로 밀림.

## In Scope

- `src-tauri/src/db/mongodb.rs`
  - `MongoAdapter::aggregate(db, collection, pipeline)` 실제 구현:
    - `validate_ns(db, collection)` 재사용.
    - `coll.aggregate(pipeline).await` 로 cursor 획득 → `while let Some(next) = cursor.next().await { ... }` 로 Document 수집.
    - `columns_from_docs(&docs)` + `project_row(doc, &columns)` 를 `find` 와 동일하게 재사용.
    - `total_count` 는 aggregate 결과 rows 수(`rows.len() as i64`) 로 설정. `estimated_document_count()` 는 aggregate 결과를 반영하지 않으므로 금지.
    - `execution_time_ms` 는 find 와 같이 `Instant::now()` → `elapsed` 측정.
  - `DocumentId` 관련 필드나 `DocumentQueryResult` 시그니처 변경 금지.
  - Unit 테스트 블록(`#[cfg(test)]`)에 2+ 테스트 추가:
    - `aggregate_without_connection_returns_connection_error`
    - `aggregate_rejects_empty_namespace`
    - 기존 `aggregate_returns_unsupported` 삭제.
- `src-tauri/src/commands/document/query.rs`
  - 신규 `#[tauri::command] pub async fn aggregate_documents(state, connection_id, database, collection, pipeline: Vec<bson::Document>) -> Result<DocumentQueryResult, AppError>`
  - 구현은 `find_documents` 와 동일한 dispatch 패턴: lock → `as_document()?` → `.aggregate(...)` 호출.
- `src-tauri/src/lib.rs`
  - `invoke_handler!` 의 기존 `commands::document::query::find_documents` 다음에 `commands::document::query::aggregate_documents` 를 추가.
- `src-tauri/src/commands/document/mod.rs`
  - 상단 doc-comment 에 `aggregate_documents` 추가된 사실을 한 줄 반영.
- `src-tauri/tests/mongo_integration.rs`
  - 1~2 통합 테스트 추가:
    - `test_mongo_adapter_aggregate_match_sort` — 기존 fixture 에 `[{$match: {age: {$gt: 25}}}, {$sort: {_id: 1}}]` 실행 → 2개 row (_id 1, 2) 반환 검증.
    - `test_mongo_adapter_aggregate_group_count` — `[{$group: {_id: null, total: {$sum: 1}}}]` 실행 → 1 row (`total` field) 검증.
  - fixture 는 기존 `test_mongo_adapter_infer_and_find_on_seeded_collection` 에서 만든 `table_view_test.users` 를 재사용 또는 동일 seed 로 재구성 (cleanup 포함).

## Out of Scope

- Frontend 변경 전체. `TableTab.queryMode`, `QueryEditor` CodeMirror JSON extension, Find/Aggregate 토글, QueryTab execute 분기 — Sprint 73.
- MQL Preview 모달 / QueryPreviewModal 일반화 — Sprint 80.
- 인라인 편집, insert/update/delete — Sprint 80.
- Pipeline 의 `$out` / `$merge` / `$indexStats` 같은 side-effect stage 지원 — 범위 밖. Cursor 결과만 수집하는 read-path 로 제한.
- Aggregate 결과 cursor 의 페이지네이션. 전체 결과를 한 번에 메모리 수집한다. 대규모 pipeline 은 호출자가 `$limit` 을 파이프라인에 포함시키는 것으로 제어.
- `DocumentQueryResult` shape 확장.

## Invariants

- `MongoAdapter::find`, `infer_collection_fields`, `list_databases`, `list_collections`, connect/disconnect/ping 동작 전부 불변.
- `columns_from_docs`, `project_row`, `infer_columns_from_samples`, `bson_type_name` 등 helper shape 및 동작 불변 (aggregate 가 이들을 **소비만** 한다).
- `DocumentQueryResult` 필드 · 순서 · 의미 불변. `total_count` 해석만 "aggregate 결과 row 수" 로 문서화.
- `find_documents` Tauri 커맨드 signature 불변.
- `ActiveAdapter::as_document()`, `DocumentAdapter` trait signature 불변 (trait 에는 `aggregate` 가 이미 존재).
- Frontend (`src/**`) diff 0.
- Rust convention (`.claude/rules/rust-conventions.md`): `cargo fmt`, `cargo clippy -D warnings`, `unwrap()` 테스트 제외 금지, `?` 로 전파, `thiserror` 기반 `AppError` 재사용.

## Acceptance Criteria

- `AC-01` `MongoAdapter::aggregate(db, collection, pipeline)` 의 `Unsupported` stub 이 제거되고 실제 `coll.aggregate(pipeline).await` 구현으로 교체된다. `grep "Unsupported" src-tauri/src/db/mongodb.rs | wc -l` 가 find/aggregate 관련 라인 1개 이상 감소.
- `AC-02` aggregate cursor 결과의 `raw_documents` 가 원본 `Document` 로 보존되고, `columns` / `rows` 는 `columns_from_docs` + `project_row` 를 재사용해 find 와 동일한 flatten 규칙을 따른다.
- `AC-03` `DocumentQueryResult.total_count` 는 aggregate 결과 rows 수 (`rows.len() as i64`). `estimated_document_count()` 호출이 aggregate path 에 **없다**.
- `AC-04` 빈 pipeline (`Vec::new()`) 실행이 `$match:{}` 없이 전체 컬렉션 반환으로 수렴 (pass-through 동작). 에러 없음.
- `AC-05` `validate_ns(db, collection)` 가 aggregate 경로에서도 호출되어 빈 db/collection 을 `AppError::Validation` 으로 거부한다.
- `AC-06` 연결 전 `aggregate(...)` 호출은 `AppError::Connection` 을 반환 (기존 `find` 와 동일 패턴).
- `AC-07` `commands/document/query.rs::aggregate_documents` Tauri 커맨드 추가: `state.active_connections.get(&id)` 로 lock → `.as_document()?.aggregate(&db, &coll, pipeline).await`. 미연결 id 는 `AppError::NotFound`, RDB 연결은 `AppError::Unsupported`.
- `AC-08` `src-tauri/src/lib.rs::run()` 의 `tauri::generate_handler![...]` 에 `commands::document::query::aggregate_documents` 가 포함되어 Frontend 가 `invoke("aggregate_documents", ...)` 로 호출 가능.
- `AC-09` 단위 테스트 2+ 추가: 연결-미설정 → Connection error, 빈 namespace → Validation error. 기존 `aggregate_returns_unsupported` 테스트는 삭제/대체.
- `AC-10` 통합 테스트 2+ 추가 (`mongo_integration.rs`): `$match + $sort` pipeline 이 결과 행 수 · 컬럼 순서 · raw_documents 를 올바르게 반환; `$group` aggregate 가 집계 결과를 row 로 반환. 테스트 컨테이너 없으면 기존 skip 패턴 재사용.
- `AC-11` Frontend 변경 0. `git diff --stat HEAD -- src/` 가 빈 출력. `pnpm tsc --noEmit`, `pnpm lint` 모두 0 error.
- `AC-12` Verification Plan 6 checks 전부 통과.

## Design Bar / Quality Bar

- `aggregate` 구현은 `find` 와 최대한 대칭을 이뤄야 한다 (동일한 `started = Instant::now()` pattern, 동일한 `cursor.next()` loop, 동일한 error wrapping `AppError::Database(format!("aggregate failed: {e}"))`).
- `coll.aggregate(pipeline)` 의 빌더 체인은 `.with_options` 없이 기본. AggregateOptions 추가 필드는 Sprint 80 이후 논의.
- `aggregate_documents` command 의 `pipeline` 파라미터는 `Vec<bson::Document>` 로 받는다 (serde 가 `Record<string, unknown>[]` 에서 자동 역직렬화). 별도 wrapper 구조체 도입 금지.
- Unit test 는 기존 mongodb.rs `#[cfg(test)]` 모듈 하단에 naming `test_aggregate_*` 로 추가. test function 명 컨벤션: `test_<동작>_<조건>_<기대결과>`.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --all -- --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `cd src-tauri && cargo test --lib db::mongodb` (mongodb 모듈 scope)
4. `cd src-tauri && cargo test --test mongo_integration` (Docker 컨테이너 올라와 있으면 실제 검증, 없으면 기존 skip 패턴)
5. `pnpm tsc --noEmit` (Frontend 회귀 0 증명)
6. `pnpm lint` (Frontend 회귀 0 증명)

**Orchestrator 가 별도로 실행하는 체크**:
- `cd src-tauri && cargo test --lib` (전체 Rust unit test)
- `pnpm vitest run` (전체 frontend suite)

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 역할
  - 6개 generator-scope check 결과 + 핵심 지표 (통과 테스트 수, clippy warning 수)
  - 각 AC → 테스트 이름 매핑
  - `aggregate` 구현 시작-끝 라인 (file:line range)
  - `aggregate_documents` command 정의 위치
  - `lib.rs` invoke_handler 등록 라인
- Evaluator must cite:
  - `mongodb.rs` aggregate 구현 스니펫 (실제 cursor.next() 루프 확인)
  - `query.rs::aggregate_documents` 스니펫
  - `lib.rs` invoke_handler 등록 확인
  - `aggregate_returns_unsupported` 테스트가 **삭제**되었음 증거 (grep)
  - 신규 단위 테스트 + 통합 테스트 이름
  - Frontend invariant (git diff --stat 결과)

## Test Requirements

### Unit Tests (필수)

- `test_aggregate_without_connection_returns_connection_error` — 새 `MongoAdapter::new()` 에서 `aggregate("db", "coll", vec![])` 호출 시 `AppError::Connection` 확인.
- `test_aggregate_rejects_empty_namespace` — 빈 db 또는 collection 에서 `AppError::Validation` 확인.

### Integration Tests (필수)

- `test_mongo_adapter_aggregate_match_sort` — 기존 fixture (`table_view_test.users`) 에 대해 `[{$match: {age: {$gt: 25}}}, {$sort: {_id: 1}}]` 실행 → row 수 ≥ 2, 첫 row `_id == 1`, `raw_documents` 길이 일치.
- `test_mongo_adapter_aggregate_group_count` — `[{$group: {_id: null, total: {$sum: 1}}}]` 실행 → 1 row, `columns` 에 `total` 포함, `rows[0][total_idx]` 수치 검증.

### Coverage Target

- `MongoAdapter::aggregate` 로직: 라인 80% 이상 (unit + integration 합산).

### Scenario Tests (필수)

- [x] Happy path — match + sort, group.
- [x] 에러/예외 — 연결 전, 빈 namespace.
- [x] 경계 — 빈 pipeline (통합 테스트에서 선택적으로 — 필수는 아님).
- [x] 기존 기능 회귀 없음 — find path unit tests 유지, frontend diff 0.

## Test Script / Repro Script

1. `cd src-tauri && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test --lib db::mongodb`
3. `cd src-tauri && cargo test --test mongo_integration`
4. `pnpm tsc --noEmit && pnpm lint`
5. `git diff --stat HEAD -- src/` → 빈 출력

## Ownership

- Generator: Sprint 72 harness generator.
- Write scope:
  - 수정: `src-tauri/src/db/mongodb.rs`, `src-tauri/src/commands/document/query.rs`, `src-tauri/src/commands/document/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/mongo_integration.rs`
  - 그 외 파일 diff 금지. 특히 `src/**` (frontend), `src-tauri/src/db/postgres.rs`, `src-tauri/src/db/mod.rs`, `src-tauri/src/commands/rdb/**`, `src-tauri/src/commands/connection.rs` **전부 read-only**.
- Merge order: Sprint 73 가 이 커맨드를 소비하므로 PASS 후에만 Sprint 73 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (6개 generator-scope + orchestrator 2개)
- Acceptance criteria evidence linked in `handoff.md`
