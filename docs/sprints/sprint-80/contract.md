# Sprint Contract: sprint-80 (Phase 6 plan F-1 — MongoAdapter mutate backend)

## Summary

- Goal: Phase 6 Sprint F 를 3 개의 sub-sprint 로 분할한 첫 번째 절반. `MongoAdapter::insert_document` / `update_document` / `delete_document` 의 `AppError::Unsupported` 스텁을 실제 driver-backed 구현으로 교체하고, 이를 소비할 3 개의 Tauri command (`insert_document` / `update_document` / `delete_document`) 를 `commands/document/mutate.rs` 로 추가한다. 프론트엔드 wiring 은 Sprint 86 (F-2) / Sprint 87 (F-3) 에서 수행.
- Audience: Sprint 86 (Phase 6 F-2 — Frontend `mqlGenerator.ts` + `useDataGridEdit` paradigm dispatch + tauri wrappers) 가 이 backend 를 소비한다. Sprint 87 (F-3) 는 `DocumentDataGrid` 인라인 편집 / QueryPreview 모달 일반화 / AddDocumentModal + Delete UI 를 완성한다.
- Owner: Sprint 80 harness generator.
- Verification Profile: `command` (cargo clippy + cargo test --lib + cargo test --test mongo_integration + frontend regression check).

Phase 6 master plan (`/Users/felix/.claude/plans/idempotent-snuggling-brook.md` — Sprint F 섹션) 의 backend 부분만 이 스프린트 범위. 원래 계획은 단일 Sprint F 였으나, 사용자 지시로 3 sub-sprint 분할하며 번호는 Sprint 80 / 86 / 87 로 배정 (67–69 는 theme 계열 다른 agent 작업, 70–79 는 Phase 6 D/D-2/E-1/E-2 + UX Hardening 병렬 agent 가 선점).

## In Scope

### MongoAdapter mutate 구현 (`src-tauri/src/db/mongodb.rs`)

- `insert_document(db, coll, doc)` — `AppError::Unsupported` 스텁 제거.
  - `validate_ns(db, coll)` 로 빈 입력 reject.
  - `current_client()` 획득 → `client.database(db).collection::<Document>(coll)` 얻기.
  - `coll.insert_one(doc).await` 호출. 실패 → `AppError::Database(..)` 로 래핑.
  - `insert_one_result.inserted_id` (`Bson`) 을 `DocumentId` 로 변환:
    - `Bson::ObjectId(oid)` → `DocumentId::ObjectId(oid.to_hex())`
    - `Bson::String(s)` → `DocumentId::String(s)`
    - `Bson::Int32(n)` → `DocumentId::Number(n as i64)`
    - `Bson::Int64(n)` → `DocumentId::Number(n)`
    - 그 외 → `DocumentId::Raw(bson)`
- `update_document(db, coll, id, patch)` — 스텁 제거.
  - `validate_ns` 실행.
  - `patch` 가 `_id` 키를 포함하면 `AppError::Validation("update_document: patch must not contain _id")` 로 reject (master plan 의 위험 연산 가드).
  - `id` → BSON 값 변환 헬퍼 `document_id_to_bson(&DocumentId) -> Result<Bson, AppError>` 사용:
    - `ObjectId(hex)` → `bson::oid::ObjectId::parse_str(&hex)` → `Bson::ObjectId(_)`. 실패 → `AppError::Validation(..)`.
    - `String(s)` → `Bson::String(s)`.
    - `Number(n)` → `Bson::Int64(n)`.
    - `Raw(bson)` → `bson` 그대로.
  - `filter = doc! { "_id": bson_value }`.
  - `update = doc! { "$set": patch }`.
  - `coll.update_one(filter, update).await` 호출.
  - `matched_count == 0` 인 경우 `AppError::NotFound(format!("document with _id ... not found"))` 반환.
- `delete_document(db, coll, id)` — 스텁 제거.
  - `validate_ns` 실행.
  - `document_id_to_bson` 으로 BSON 필터 생성.
  - `coll.delete_one(filter).await` 호출.
  - `deleted_count == 0` 인 경우 `AppError::NotFound(..)`.
- 헬퍼 함수 `document_id_to_bson(&DocumentId) -> Result<Bson, AppError>` 를 `mongodb.rs` 하단 `// ── Helpers` 섹션에 private 로 추가 (mutate 세 메서드가 공유).
- 헬퍼 함수 `bson_id_to_document_id(&Bson) -> DocumentId` (insert 결과 변환용) 를 동일 섹션에 추가.

### Tauri commands (`src-tauri/src/commands/document/mutate.rs` 신규)

- 파일 머리에 module doc-comment: Phase 6 F-1 scope, error propagation pattern, `as_document()?` dispatch 설명.
- 3 개의 `#[tauri::command]` async 함수:
  - `insert_document(state, connection_id, database, collection, document: bson::Document) -> Result<DocumentId, AppError>`
  - `update_document(state, connection_id, database, collection, document_id: DocumentId, patch: bson::Document) -> Result<(), AppError>`
  - `delete_document(state, connection_id, database, collection, document_id: DocumentId) -> Result<(), AppError>`
- 각 커맨드는 `browse.rs` / `query.rs` 의 패턴 그대로:
  1. `state.active_connections.lock().await`
  2. `connections.get(&connection_id).ok_or_else(|| not_connected(&connection_id))?`
  3. `active.as_document()?.method(..)`
- `not_connected` 는 `browse.rs` / `query.rs` 에 이미 있는 형태를 복제 (`AppError::NotFound(format!("Connection '{}' not found", id))`).

### Module wiring (`src-tauri/src/commands/document/mod.rs`)

- `pub mod mutate;` 추가.
- Module-level doc-comment 업데이트: Sprint 80 mutate 도입 설명, "future sprints" 문구 제거 또는 Sprint 86/87 frontend 언급으로 변경.

### Tauri handler (`src-tauri/src/lib.rs`)

- `invoke_handler![...]` 배열에 3 개 라인 추가 (query.rs 뒤에):
  ```rust
  commands::document::mutate::insert_document,
  commands::document::mutate::update_document,
  commands::document::mutate::delete_document,
  ```

### Unit tests (`src-tauri/src/db/mongodb.rs` `#[cfg(test)] mod tests`)

- **기존 스텁 회귀 테스트 업데이트 필수**: `insert_document_returns_unsupported` / `update_document_returns_unsupported` / `delete_document_returns_unsupported` 3 개는 모두 제거하거나, 같은 이름으로 "no connection → Connection error" 로 내용 교체. 기존 assertion (`AppError::Unsupported`) 은 이제 false positive 가 됨.
- 신규 테스트:
  - `insert_document_without_connection_returns_connection_error`
  - `insert_document_rejects_empty_namespace`
  - `update_document_without_connection_returns_connection_error`
  - `update_document_rejects_empty_namespace`
  - `update_document_rejects_id_in_patch` — `patch = doc! { "_id": ObjectId::new() }` → `AppError::Validation`.
  - `delete_document_without_connection_returns_connection_error`
  - `delete_document_rejects_empty_namespace`
  - `document_id_to_bson_parses_objectid_hex` — hex 32 자리 → `Bson::ObjectId` (성공).
  - `document_id_to_bson_rejects_invalid_objectid_hex` — `DocumentId::ObjectId("not-hex")` → `AppError::Validation`.
  - `document_id_to_bson_preserves_string_and_number` — `String("s")` / `Number(42)` round-trip.
  - `bson_id_to_document_id_maps_objectid_and_int32` — `Bson::ObjectId(_)` → `DocumentId::ObjectId(hex)`; `Bson::Int32(5)` → `DocumentId::Number(5)`.

### Integration tests (`src-tauri/tests/mongo_integration.rs`)

- 신규 테스트 (docker 없으면 skip):
  - `test_mongo_adapter_insert_roundtrip` — 새 collection `table_view_test.mutate_roundtrip` seed → clear → `adapter.insert_document(...)` → `adapter.find(...)` 결과에 inserted id 존재 검증 → drop.
  - `test_mongo_adapter_update_applies_set` — `insert_document` → `update_document({_id, {"name": "new"}})` → `find` 후 name field 비교.
  - `test_mongo_adapter_update_rejects_id_in_patch` — `update_document(id, doc!{"_id": ObjectId::new()})` → `AppError::Validation` 매칭.
  - `test_mongo_adapter_update_on_missing_id_returns_not_found` — 무작위 ObjectId 로 update → `AppError::NotFound`.
  - `test_mongo_adapter_delete_removes_document` — insert → delete → find → 결과 0 건.
  - `test_mongo_adapter_delete_on_missing_id_returns_not_found` — 무작위 ObjectId → `AppError::NotFound`.
- 테스트마다 fixture collection 은 setup 시 `drop_collection`, teardown 시 다시 `drop_collection` 로 격리.
- `#[serial_test::serial]` attribute 로 테스트 간 직렬화 (이미 사용중인 패턴).

## Out of Scope

- Frontend 전체 (`src/**`) — Sprint 86 / 87 범위.
  - `mqlGenerator.ts`, `useDataGridEdit` paradigm 분기, DocumentDataGrid 편집 UI, AddDocumentModal, QueryPreview 모달 일반화, `DocumentId` TS 타입 모두 **Sprint 86/87**.
- `insert_many` / `update_many` / `delete_many` bulk 경로 — Phase 6 out of scope (plan 명시).
- 중첩 필드 dot-path 편집 (`{$set: {"profile.name": ...}}`) — Sprint 87 이후 검토.
- Transaction / replica set session 지원 — Phase 6 out of scope.
- MQL Preview 모달 / JSON Editor — Sprint 87.
- `DocumentId::Raw(bson)` 의 모든 variant 완전 지원 — 현재 스펙은 `ObjectId` / `String` / `Number` / `Raw` 4 케이스에서 Raw 는 pass-through 만.
- `$out` / `$merge` aggregate side-effect — Phase 6 out of scope.

## Invariants

- 기존 `MongoAdapter` 의 `connect` / `disconnect` / `ping` / `list_databases` / `list_collections` / `infer_collection_fields` / `find` / `aggregate` 시그니처 + 동작 완전 불변. 4 개 async fn 의 body 는 건드리지 않음.
- `DocumentAdapter` trait (`src-tauri/src/db/mod.rs:250-300`) 시그니처 **완전 불변**. 기존 3 개 메서드 (`insert_document`/`update_document`/`delete_document`) 의 trait 선언은 현재 모양 그대로 구현만 업데이트.
- `DocumentId` enum (`src-tauri/src/db/mod.rs:62-67`) 정의 불변.
- `ActiveAdapter::as_document()` 에러 문구 불변.
- `commands/document/browse.rs` 와 `commands/document/query.rs` 파일 내용 **diff 0**. (mod.rs 만 `pub mod mutate;` 추가.)
- `commands/connection.rs`, `commands/rdb/**` diff 0.
- `src-tauri/src/models/**` diff 0.
- `src/**` (frontend 전체) diff 0.
- `docs/**` 중 `docs/sprints/sprint-80/**` 외 전부 diff 0.
- Rust 컨벤션 준수: `cargo fmt`, `-D warnings` clippy, 4 spaces indent, `unwrap()` 금지 (테스트 제외), `unsafe` 금지, `async fn` + `tokio::sync::Mutex`.
- Sprint 73 의 comments 언급 (`Sprint 69` 같은) 은 history 로 남겨도 되지만, 새 주석은 `Sprint 80` 으로 일관성 유지.

## Acceptance Criteria

- `AC-01` `MongoAdapter::insert_document` 가 `AppError::Unsupported` 를 더 이상 반환하지 않으며, valid connection 위에서 호출 시 `DocumentId` 를 반환하고 MongoDB collection 에 실제로 document 가 삽입된다 (integration test `test_mongo_adapter_insert_roundtrip` 로 증명).
- `AC-02` `MongoAdapter::update_document(id, patch)` 가 내부적으로 `$set: patch` 래핑을 수행하고, `matched_count == 0` 시 `AppError::NotFound` 를 반환한다. `patch` 가 `_id` 키를 포함하면 `AppError::Validation` 반환 (integration test 로 증명).
- `AC-03` `MongoAdapter::delete_document(id)` 가 단일 document 를 삭제하고, `deleted_count == 0` 시 `AppError::NotFound` 를 반환한다.
- `AC-04` `DocumentId::ObjectId(hex)` 가 invalid hex 문자열일 때 `AppError::Validation` 을 반환하는 `document_id_to_bson` helper 가 존재하며, valid hex 는 `Bson::ObjectId` 로 변환된다. `DocumentId::String` / `Number` / `Raw` 는 각각 `Bson::String` / `Bson::Int64` / 원본 그대로 변환된다.
- `AC-05` `bson_id_to_document_id(&Bson)` helper 가 존재하며 `Bson::ObjectId(_)` → `DocumentId::ObjectId(hex)`, `Bson::String(_)` → `DocumentId::String(_)`, `Bson::Int32/Int64(_)` → `DocumentId::Number(_)`, 그 외 → `DocumentId::Raw(_)` 매핑이 성립한다.
- `AC-06` `src-tauri/src/commands/document/mutate.rs` 파일이 존재하고 3 개의 `#[tauri::command]` async 함수 (`insert_document`, `update_document`, `delete_document`) 를 정의한다. 각 커맨드는 `AppState` + `as_document()?` pattern 을 사용한다.
- `AC-07` `src-tauri/src/commands/document/mod.rs` 에 `pub mod mutate;` 가 추가되고, `src-tauri/src/lib.rs::run` 의 `invoke_handler!` 배열에 3 개 mutate 커맨드가 등록된다 (기존 등록 순서 변경 금지 — 끝에 추가).
- `AC-08` 기존 유닛 테스트 `insert_document_returns_unsupported` / `update_document_returns_unsupported` / `delete_document_returns_unsupported` 가 제거되거나 "Unsupported → 다른 에러 (Connection / Validation)" 로 대체된다. `cargo test --lib mongodb::tests` 의 전체 테스트가 0 failure 로 통과.
- `AC-09` 신규 유닛 테스트 최소 7 개 추가 (위 In Scope 리스트의 7 항목 이상).
- `AC-10` 신규 integration 테스트 최소 5 개 추가 (위 In Scope 리스트 6 개 중 docker skip 시 skip). docker 사용 환경 (`docker compose -f docker-compose.test.yml up -d mongodb`) 에서 5 개 모두 PASS.
- `AC-11` `cargo fmt --check` 통과. `cargo clippy --all-targets --all-features -- -D warnings` 통과 (Sprint 73 baseline 0 warnings 유지).
- `AC-12` `src/**` diff 0 증명 — `git diff --stat HEAD -- src/` 출력 비어있음. `pnpm tsc --noEmit` + `pnpm lint` 여전히 PASS (Sprint 85 baseline 유지).
- `AC-13` Verification Plan 5 checks + Integration test 전부 PASS (docker 미가동 환경에서는 integration test skip 허용, 단 generator 가 docker 기동 후 실행한 결과를 증거로 제출 필요).

## Design Bar / Quality Bar

- **Error 컨텍스트 보존**: Rust 컨벤션 `context()` / `map_err()` 규칙 준수 — `insert_one` / `update_one` / `delete_one` 실패 시 모두 `AppError::Database(format!("... failed: {e}"))` 로 래핑하되, 원인 메시지 유지.
- **`_id` 가드 위치**: patch 검증은 `update_document` 진입 직후 (`validate_ns` 다음, `current_client` 전) 에 수행해 불필요한 DB round-trip 방지.
- **Integration test fixture 격리**: 각 테스트는 고유한 collection 이름 (`mutate_roundtrip`, `mutate_update`, `mutate_delete`, `mutate_missing_update`, `mutate_missing_delete`, `mutate_reject_id`) 을 사용해 병렬 실행 안정성 확보. `#[serial_test::serial]` 로 직렬화는 유지 (현재 패턴).
- **Teardown**: 각 테스트는 시작과 끝에서 collection `drop` 을 호출해 이전 테스트 잔여물 제거. Panic 시 cleanup 실패를 방지하기 위해 시작 시점 drop 이 핵심.
- **헬퍼 위치**: `document_id_to_bson` / `bson_id_to_document_id` 는 `mongodb.rs` 의 `// ── Helpers` 섹션 하단 (기존 `flatten_cell` / `infer_columns_from_samples` / `project_row` 와 같은 블록) 에 private 함수로 추가. `db/mod.rs` 에 배치하면 trait 파일이 더러워지므로 `mongodb.rs` 로 국한.
- **불필요한 mutability 금지**: `bson::Document` 는 `doc!` macro 로 새로 빌드. 기존 patch 를 mutate 하지 않음.
- **Rust convention** (`.claude/rules/rust-conventions.md`):
  - `thiserror` 기반 `AppError` 재사용.
  - `tokio::sync::Mutex` 패턴 유지 (adapter state).
  - `unwrap()` 테스트 외 금지.
  - 4 spaces indent.
- **테스트 명명**: `test_<동작>_<조건>_<기대결과>` 패턴 유지. 신규 unit test 는 `mongodb.rs` 내 기존 패턴과 일관성.
- **로깅 금지**: mutate 메서드에 `println!` / `eprintln!` / `tracing::info!` 추가 금지 — 에러는 `AppError` 를 통해서만 표현.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check` — 포맷팅 0 diff.
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — 0 warnings.
3. `cd src-tauri && cargo test --lib mongodb::tests` — MongoAdapter unit tests 전부 PASS, 신규 7+ tests 포함.
4. `cd src-tauri && cargo test --test mongo_integration` — integration tests PASS. docker 미가동 시 skip 메시지 출력하고 exit 0. docker 가동 환경에서는 신규 5 개 테스트 모두 PASS.
5. `git diff --stat HEAD -- src/` — empty output (frontend 변경 0 증명).
6. `pnpm tsc --noEmit && pnpm lint` — Sprint 85 baseline 그대로 PASS (frontend regression 0).

**Orchestrator-scope 추가 체크**:
- `cd src-tauri && cargo test --lib` (전체 Rust 유닛) — Sprint 73 baseline 216 passed 대비 +7~10 순증, 0 실패.
- `pnpm vitest run` (전체 Frontend suite) — Sprint 85 baseline 1555 passed 유지, 0 실패.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 역할 (file path + purpose).
  - 6 개 required check 의 실행 커맨드 + 결과 요약 (pass/fail + 주요 수치).
  - 각 AC (AC-01 ~ AC-13) → 구체 증거 (file:line 또는 테스트 이름).
  - `document_id_to_bson` + `bson_id_to_document_id` 헬퍼의 file:line 위치.
  - `insert_document` / `update_document` / `delete_document` 구현 body 의 file:line range.
  - `mutate.rs` Tauri command 3 개 file:line.
  - `lib.rs` 의 3 개 invoke_handler 라인 file:line.
  - Rust 컨벤션 준수 증명 (clippy 0 warnings 출력 스니펫).
  - Frontend 회귀 증명: `git diff --stat HEAD -- src/` empty.
  - Integration test 실행 환경 명시 (docker 기동 여부, mongo 버전).
- Evaluator must cite:
  - `mongodb.rs` 의 3 개 메서드 구현 실 코드 확인.
  - `mutate.rs` 커맨드 실 코드 확인.
  - `lib.rs` 의 invoke_handler 등록 확인.
  - 기존 `*_returns_unsupported` 테스트 3 개가 제거 / 대체되었음을 확인.
  - `git diff --stat HEAD -- src/` empty 증명.
  - clippy 0 warnings 증명.
  - Integration test 로그의 PASS line 또는 docker skip 메시지.

## Test Requirements

### Unit Tests (필수)

- `MongoAdapter::insert_document` — no connection → `AppError::Connection`, empty namespace → `AppError::Validation`.
- `MongoAdapter::update_document` — no connection, empty namespace, `_id` in patch 각각 별도 케이스.
- `MongoAdapter::delete_document` — no connection, empty namespace.
- `document_id_to_bson` — ObjectId hex valid/invalid, String/Number pass-through, Raw pass-through.
- `bson_id_to_document_id` — ObjectId/String/Int32/Int64/Raw 매핑 각각 1 케이스.

최소 7 테스트. 기존 3 개의 Unsupported 테스트는 제거되거나 재목적화.

### Integration Tests (필수)

- `test_mongo_adapter_insert_roundtrip` — 삽입 후 find 로 문서 존재 검증.
- `test_mongo_adapter_update_applies_set` — `$set` 이후 field 값 변경 검증.
- `test_mongo_adapter_update_rejects_id_in_patch` — Validation 에러 매칭.
- `test_mongo_adapter_update_on_missing_id_returns_not_found` — NotFound 에러 매칭.
- `test_mongo_adapter_delete_removes_document` — delete 이후 find 에 부재 검증.
- `test_mongo_adapter_delete_on_missing_id_returns_not_found` — NotFound 에러 매칭.

최소 5 테스트 (6 중 1 개는 optional — docker skip 시 한 환경에서 모두 skip 됨, 이 경우 PASS 로 간주).

### Scenario Tests (필수)

- [x] Happy path — insert/update/delete 각 성공 경로.
- [x] 에러/예외 — 없는 id, 잘못된 ObjectId hex, `_id` in patch.
- [x] 경계 조건 — 빈 namespace, 빈 patch (`doc! {}` → MongoDB 가 no-op 로 받아야 matched_count == 1 & modified_count == 0; no-op 도 "성공" 으로 간주, NotFound 는 matched_count == 0 일 때만).
- [x] 기존 기능 회귀 없음 — `cargo test --lib` 전체 유닛, integration 의 read-path 테스트 전부 PASS.

### Coverage Target

- 신규/수정 Rust 코드: 라인 80% 이상 (DbAdapter 구현체 규칙, `.claude/rules/testing.md`).

## Test Script / Repro Script

1. `cd src-tauri && cargo fmt --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `cd src-tauri && cargo test --lib mongodb::tests -- --nocapture`
4. `docker compose -f docker-compose.test.yml up -d mongodb && ./scripts/wait-for-test-db.sh` (환경 준비)
5. `cd src-tauri && cargo test --test mongo_integration`
6. `git diff --stat HEAD -- src/` — empty 확인.
7. `pnpm tsc --noEmit && pnpm lint` — 0 errors.

## Ownership

- Generator: Sprint 80 harness generator.
- Write scope (수정 허용):
  - `src-tauri/src/db/mongodb.rs`
  - `src-tauri/src/commands/document/mod.rs`
  - `src-tauri/src/lib.rs`
  - `src-tauri/tests/mongo_integration.rs`
- Write scope (신규 생성):
  - `src-tauri/src/commands/document/mutate.rs`
  - `docs/sprints/sprint-80/findings.md` + `handoff.md` (평가 후 생성)
- 그 외 파일 **전부 read-only**. 특히:
  - `src-tauri/src/db/mod.rs` (trait 선언은 이미 올바름).
  - `src-tauri/src/commands/document/browse.rs`, `query.rs`.
  - `src-tauri/src/commands/connection.rs`, `rdb/**`.
  - `src-tauri/src/models/**`, `src-tauri/src/error.rs`, `src-tauri/src/storage/**`.
  - `src-tauri/tests/common/mod.rs` (test_config 에 이미 MongoDB 지원 포함).
  - `src/**` (frontend).
  - `docs/**` 중 `docs/sprints/sprint-80/` 외.
- Merge order: Sprint 80 PASS → Sprint 86 (F-2 Frontend generator/dispatch) 착수. Sprint 86 PASS → Sprint 87 (F-3 UI completion) 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (6 개 generator-scope + orchestrator 2 개)
- Acceptance criteria evidence linked in `handoff.md`
- Integration test docker skip 환경에서는 "skipped" 명시적 로그와 exit 0 허용. docker 가동 환경에서는 신규 5 개 테스트 모두 PASS.
