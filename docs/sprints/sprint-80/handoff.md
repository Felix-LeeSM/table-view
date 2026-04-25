# Sprint 80 Handoff — Phase 6 plan F-1 (MongoAdapter mutate backend)

## Status

**PASS** — Evaluator scorecard 10/10 across all 6 dimensions (Contract Fidelity, Correctness, Test Coverage, Code Quality, Invariants Preserved, Verification Rigor). All 13 ACs verified. Ready to unblock Sprint 86 (F-2 frontend generator/dispatch).

## Changed Files

- `src-tauri/src/db/mongodb.rs` — 3 `AppError::Unsupported` mutate 스텁을 실제 driver-backed 구현으로 교체 (L465-557). 3 helpers (`document_id_to_bson` L807-816, `bson_id_to_document_id` L824-832, `describe_document_id` L837-844) 를 `// ── Mutate helpers (Sprint 80)` 섹션에 private 로 추가. 기존 3 개 `*_returns_unsupported` 유닛 테스트 제거 + 13 개 신규 테스트 추가.
- `src-tauri/src/commands/document/mutate.rs` (NEW, 121 lines) — 3 `#[tauri::command]` async fn (`insert_document` L54-70, `update_document` L79-96, `delete_document` L104-120). `browse.rs` / `query.rs` 와 동일한 `state.active_connections.lock → get → as_document()? → method()` dispatch pattern. `not_connected` helper 로컬 복제.
- `src-tauri/src/commands/document/mod.rs` — `pub mod mutate;` (L24). Module doc-comment 에 Sprint 80 / 86 / 87 context 추가.
- `src-tauri/src/lib.rs` — `invoke_handler!` 끝에 3 개 mutate 커맨드 등록 (L53-55), 기존 순서 유지.
- `src-tauri/tests/mongo_integration.rs` — 6 개 신규 `#[serial_test::serial]` integration test. 각 테스트 고유 collection (`mutate_roundtrip` / `mutate_update` / `mutate_delete` / `mutate_missing_update` / `mutate_missing_delete` / `mutate_reject_id`) 사용, 양끝 `drop_collection` 으로 idempotent 격리.

## Checks Run (generator + orchestrator scope)

| Check | Result |
|---|---|
| `cd src-tauri && cargo fmt --check` | PASS (0 diff) |
| `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` | PASS (0 warnings) |
| `cd src-tauri && cargo test --lib mongodb::tests` | PASS (35/35, +10 vs baseline 25) |
| `cd src-tauri && cargo test --lib` | PASS (226/226, +10 vs Sprint 73 baseline 216) |
| `cd src-tauri && cargo test --test mongo_integration` | PASS (11/11 against Docker `mongo:7`; 6 new + 5 existing) |
| `git diff --stat HEAD -- src/` | Pre-existing `ConnectionDialog.tsx` diff (Sprint 79 `f5a3faa`), Sprint 80 scope: no change |
| `pnpm tsc --noEmit` | PASS (0 errors) |
| `pnpm lint` | PASS (0 errors) |
| `pnpm vitest run` | PASS (1558/1558, Sprint 85 baseline 1555 preserved) |

## Done Criteria Coverage (AC-01 ~ AC-13)

- **AC-01** `MongoAdapter::insert_document` (`mongodb.rs:465-483`) — `test_mongo_adapter_insert_roundtrip` PASS. Driver 결과 `inserted_id` 을 `bson_id_to_document_id` 로 `DocumentId` 변환.
- **AC-02** `MongoAdapter::update_document` (`mongodb.rs:485-526`) — `$set` 래핑 L510, `_id` guard L499-503 (`validate_ns` 직후, `current_client` 전), `matched_count==0 → NotFound` L517-522. `test_mongo_adapter_update_applies_set` / `_rejects_id_in_patch` / `_on_missing_id_returns_not_found` PASS.
- **AC-03** `MongoAdapter::delete_document` (`mongodb.rs:528-557`) — `deleted_count==0 → NotFound` L548-553. `test_mongo_adapter_delete_removes_document` / `_on_missing_id_returns_not_found` PASS.
- **AC-04** `document_id_to_bson` (`mongodb.rs:807-816`) — 4 variants (ObjectId hex valid/invalid, String, Number, Raw). 4 유닛 테스트 PASS.
- **AC-05** `bson_id_to_document_id` (`mongodb.rs:824-832`) — 5 케이스 (ObjectId, String, Int32, Int64, Raw). 2 유닛 테스트 PASS.
- **AC-06** `commands/document/mutate.rs` — 3 Tauri commands with `as_document()?` dispatch.
- **AC-07** `mod.rs` L24 `pub mod mutate;`, `lib.rs` L53-55 invoke_handler.
- **AC-08** 기존 3 개 `*_returns_unsupported` 테스트 제거 / `*_without_connection_returns_connection_error` + `*_rejects_empty_namespace` + `update_document_rejects_id_in_patch` 로 대체.
- **AC-09** 13 개 신규 유닛 테스트 (요구 ≥7).
- **AC-10** 6 개 신규 integration test (요구 ≥5). Docker `mongo:7` 가동 환경에서 PASS.
- **AC-11** `cargo fmt --check` 0 diff, `cargo clippy -D warnings` 0 warnings.
- **AC-12** Sprint 80 이 `src/**` 을 수정하지 않음. 기존 `ConnectionDialog.tsx` diff 는 Sprint 79 이후 미커밋 상태로 존재. `pnpm tsc/lint/vitest` PASS 유지.
- **AC-13** 6 required checks + 2 orchestrator checks 전부 PASS.

## Assumptions

- Docker `mongo:7` 이 `localhost:27017` 에서 healthy 상태로 가동 중 (generator 가 `docker compose ps` 로 확인). 미가동 환경에서는 integration test 가 `setup_mongo_adapter` 의 기존 skip 패턴을 따름.
- MongoDB driver `mongodb = "3"` + `bson = "2"` (기존 `Cargo.toml` 유지).
- `_id` guard 는 top-level key 만 감지. 중첩 경로 (`{"profile._id": ...}`) 는 MongoDB 가 서버 레벨에서 거부 — Sprint 80 에서 별도 가드 추가 없음.
- Empty patch (`doc! {}`) 는 no-op 로 success (matched_count >= 1, modified_count == 0) — contract Scenario Tests 에 맞춤.
- `describe_document_id` private helper 는 NotFound 메시지용 — contract 에 명시되지 않았지만 error context preservation 을 위해 필요 (Raw variant 의 raw Bson 노출 방지).

## Residual Risks

- **Pre-existing `src/components/connection/ConnectionDialog.tsx` diff**: 767-line uncommitted modification from prior session (last committed `f5a3faa` Sprint 79). Sprint 80 scope 밖. Orchestrator 는 Sprint 86 착수 전에 이 상태를 어떻게 처리할지 결정 필요 (commit / stash / revert).
- **`DocumentId::Raw(bson)` pass-through**: 복합 BSON (예: Document, Array) 을 `_id` 로 보내는 경우 driver 가 서버 에러로 reject — 현재 스펙 내 pass-through 만 수행.
- **Transaction / replica-set sessions 미사용**: single-shot `update_one` / `delete_one` 이 주변 read 와 atomic 하지 않음 → Sprint 86/87 UI 에서 optimistic concurrency 필요 시 별도 처리.
- **중첩 경로 편집 미지원**: `{$set: {"profile.name": ...}}` 는 adapter 가 reject 하지 않지만 UI 에서 노출되지 않음 — Sprint 87 이후 검토.

## Handoff to Sprint 86 (F-2 Frontend)

Sprint 86 이 소비할 backend 계약:

| Tauri command | Args | Return |
|---|---|---|
| `insert_document` | `connection_id: string, database: string, collection: string, document: bson::Document` | `DocumentId` |
| `update_document` | `connection_id: string, database: string, collection: string, document_id: DocumentId, patch: bson::Document` | `void` |
| `delete_document` | `connection_id: string, database: string, collection: string, document_id: DocumentId` | `void` |

Error variants (Tauri 로 직렬화됨):
- `AppError::Validation` — empty namespace, invalid ObjectId hex, `_id` in patch
- `AppError::Connection` — adapter not connected
- `AppError::NotFound` — unknown connection id OR `matched_count/deleted_count == 0`
- `AppError::Database` — driver call failure
- `AppError::Unsupported` — paradigm mismatch (e.g. Postgres adapter dispatched to document command)

Sprint 86 작업:
- `src/types/documentMutate.ts` — `DocumentId` TS 타입 미러 (`ObjectId` / `String` / `Number` / `Raw` tagged union)
- `src/lib/mongo/mqlGenerator.ts` — grid diff → `{$set: patch}` bson 생성 + MQL preview 문자열 (`db.coll.updateOne({_id: ObjectId("...")}, {$set: {...}})`) 생성
- `src/hooks/useDataGridEdit.ts` — paradigm 분기 (rdb → SQL, document → MQL)
- 3 Tauri wrapper (`src/lib/tauri/documentMutate.ts`)
- Paradigm 분기 단위 테스트

Sprint 87 작업:
- `DocumentDataGrid` 인라인 편집 / Pending diff 하이라이트 / Commit 버튼
- `QueryPreviewModal` 일반화 (paradigm 별 내부 렌더)
- `AddDocumentModal` (JSON editor → insert_one)
- Row Delete 확인 모달
