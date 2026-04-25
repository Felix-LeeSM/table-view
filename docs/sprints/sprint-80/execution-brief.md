# Sprint Execution Brief: sprint-80 (Phase 6 plan F-1 — MongoAdapter mutate backend)

## Objective

`MongoAdapter` 의 `insert_document` / `update_document` / `delete_document` 스텁을 실제 driver-backed 구현으로 교체하고, 이를 프론트엔드가 호출할 수 있도록 3 개의 Tauri command (`commands/document/mutate.rs`) 를 추가한다. 프론트엔드 wiring 은 Sprint 86 / 87 범위.

## Task Why

- Phase 6 의 최종 goal (MongoDB 편집 경로 완성) 중 backend 절반을 닫는다. 현재 trait 은 3 개 메서드를 이미 선언했지만 구현은 `AppError::Unsupported` 스텁 — frontend 가 Sprint 86 에서 `mqlGenerator.ts` 를 붙이려면 backend 가 먼저 준비되어야 한다.
- 3 sub-sprint 분할 근거: Sprint 80 (backend) → Sprint 86 (frontend generator + dispatch) → Sprint 87 (UI + modal) 로 의존성을 따라 레이어링. Sprint 80 이 먼저 PASS 해야 Sprint 86 이 실제 tauri command 를 mock 없이 호출할 수 있음.
- TablePlus 전환성 기준: mongo 사용자가 "셀 더블클릭 → 편집 → MQL Preview 확인 → Commit" 으로 document 를 변경할 수 있어야 Phase 6 완료. 이 워크플로우의 백엔드 진입점이 본 스프린트 산출물.

## Scope Boundary

- **Hard stop**: `src/**` (frontend) 전체, `src-tauri/src/commands/connection.rs`, `rdb/**`, `document/browse.rs`, `document/query.rs`, `models/**`, `error.rs`, `db/mod.rs` 모두 **read-only**. `git diff --stat HEAD -- <위 경로>` 출력이 비어있어야 함.
- **docs/**: `docs/sprints/sprint-80/` 외 전부 read-only. 기존 phase / plan / ADR / lesson 문서 변경 금지.
- **trait 선언 불변**: `DocumentAdapter` (`src-tauri/src/db/mod.rs:250-300`) 시그니처 · `DocumentId` enum 정의는 이미 올바름. 건드리지 않는다.

## Invariants

- 기존 `MongoAdapter` 의 connect / disconnect / ping / list_databases / list_collections / infer_collection_fields / find / aggregate 의 body + 시그니처 **완전 불변**.
- `ActiveAdapter::as_document()` 에러 문구 불변.
- Postgres adapter / RDB commands 전혀 건드리지 않음 → `cd src-tauri && cargo test --lib postgres::` 회귀 0.
- Integration test 의 read-path 테스트 (`test_mongo_adapter_connect_ping_list_disconnect_happy_path`, `test_mongo_adapter_infer_and_find_roundtrip`, Sprint 72 의 aggregate 테스트 2 개) 모두 PASS 유지.
- 프론트엔드: Sprint 85 baseline 1555 vitest tests PASS 상태 유지. `pnpm tsc --noEmit` + `pnpm lint` 0 errors.
- Rust 컨벤션 전부 준수 (cargo fmt, clippy -D warnings, unwrap 테스트 외 금지, 4 spaces).

## Done Criteria

1. `MongoAdapter::insert_document` 가 실제 insert 를 수행하고 `DocumentId` 반환. 에러 경로 (no connection, empty namespace, driver error) 명확.
2. `MongoAdapter::update_document` 가 `$set: patch` 래핑으로 단일 document 업데이트, `matched_count == 0` → `AppError::NotFound`, patch 에 `_id` 포함 시 `AppError::Validation`.
3. `MongoAdapter::delete_document` 가 단일 document 삭제, `deleted_count == 0` → `AppError::NotFound`.
4. `document_id_to_bson` + `bson_id_to_document_id` private helper 가 `mongodb.rs` 에 존재하며 4 variants 전부 cover.
5. `src-tauri/src/commands/document/mutate.rs` 에 3 개의 `#[tauri::command]` async fn 존재, `as_document()?` dispatch pattern 유지.
6. `commands/document/mod.rs` 에 `pub mod mutate;` 추가, `lib.rs` invoke_handler 에 3 커맨드 등록.
7. 기존 3 개의 `*_returns_unsupported` 유닛 테스트 제거 / 재목적화. 신규 7+ 개 유닛 테스트 추가.
8. Integration test 5+ 개 추가 (docker 가동 시 모두 PASS, skip 환경에서는 전체 test exit 0).
9. `cargo clippy --all-targets --all-features -- -D warnings` 0 warnings.
10. `cargo fmt --check` 0 diff.
11. Frontend 회귀 0 (`git diff --stat HEAD -- src/` empty, `pnpm tsc --noEmit && pnpm lint` 0 errors, `pnpm vitest run` Sprint 85 baseline 1555 tests PASS).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --check` → 0 diff.
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` → 0 warnings / 0 errors.
  3. `cd src-tauri && cargo test --lib mongodb::tests -- --nocapture` → 신규 7+ 테스트 포함 전부 PASS.
  4. `cd src-tauri && cargo test --test mongo_integration` → docker 가동 시 기존 + 신규 5 integration 테스트 모두 PASS, 미가동 시 skip 로그 + exit 0.
  5. `git diff --stat HEAD -- src/` → empty output.
  6. `pnpm tsc --noEmit && pnpm lint` → 0 type error / 0 lint error.
- Required evidence:
  - `mongodb.rs` 3 메서드 구현 body file:line range.
  - 2 개 helper 함수 file:line.
  - `mutate.rs` 3 commands file:line.
  - `lib.rs` invoke_handler 3 lines file:line.
  - 기존 Unsupported 테스트 제거/대체 증명 (diff 또는 before/after 스니펫).
  - Integration test docker 로그 또는 skip 메시지.
  - `git diff --stat HEAD -- src/` empty.
  - clippy 출력 스니펫 (0 warnings 확인).

## Evidence To Return

- Changed files + purpose (아래 5 개 + 신규 mutate.rs + sprint-80/ 아티팩트).
- 6 개 check 실행 커맨드 + 결과 수치.
- AC-01 ~ AC-13 각각 증거 (file:line 또는 test name).
- Assumptions (docker 가동 여부, mongo 버전, patch `_id` 가드 위치, `matched_count == 0` 정책 등).
- Residual risk (예: `DocumentId::Raw` 의 모든 variant 완전 지원 부재, transaction 미지원 등).

## References

- Contract: `docs/sprints/sprint-80/contract.md`
- 이전 Sprint 72 handoff (aggregate 추가, 동일 구조 reference): `docs/sprints/sprint-72/handoff.md`
- 이전 Sprint 73 handoff (frontend UI reference for Sprint 86/87): `docs/sprints/sprint-73/handoff.md`
- 이전 Sprint 66 handoff (infer_collection_fields + find 구현 패턴 reference): `docs/sprints/sprint-66/handoff.md` (있다면)
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint F 섹션)
- Rust conventions: `.claude/rules/rust-conventions.md`
- Testing conventions: `.claude/rules/testing.md`
- Relevant files:
  - `src-tauri/src/db/mongodb.rs` (스텁 3 개 위치 : L452-491)
  - `src-tauri/src/db/mod.rs:62-67` (`DocumentId` enum), `:250-300` (`DocumentAdapter` trait)
  - `src-tauri/src/commands/document/browse.rs` (동일 dispatch 패턴 reference)
  - `src-tauri/src/commands/document/query.rs` (동일 dispatch 패턴 reference, `find_documents`/`aggregate_documents`)
  - `src-tauri/src/commands/document/mod.rs:20-21` (현재 `pub mod browse; pub mod query;`)
  - `src-tauri/src/lib.rs:48-52` (현재 document 커맨드 등록 위치, 뒤에 추가)
  - `src-tauri/tests/mongo_integration.rs` (fixture seed/drop 패턴 reference)
  - `src-tauri/tests/common/mod.rs:120-139` (`setup_mongo_adapter` helper)
