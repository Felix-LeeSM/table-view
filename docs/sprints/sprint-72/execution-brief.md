# Sprint Execution Brief: sprint-72 (Phase 6 plan E-1)

## Objective

- `MongoAdapter::aggregate` 의 `Unsupported` 스텁을 실제 aggregate cursor 실행으로 교체한다.
- `commands/document/query.rs` 에 `aggregate_documents` Tauri 커맨드를 추가하고 `lib.rs` invoke_handler 에 등록한다.
- 단위 테스트 2개 + 통합 테스트 2개를 추가해 behavior 를 고정한다.
- Frontend 변경 0 을 유지한다 (Sprint 73 에서 UI 소비).

## Task Why

- Sprint 70/71 이 Quick Look 과 선택 인프라까지 확보함. 이제 백엔드가 find 만 지원해서 쿼리 모드 UI 가 들어갈 수가 없음.
- Phase 6 master plan 의 Sprint E 는 backend + frontend 를 한 번에 묶었으나 양이 많아 Sprint D(1/D-2) 처럼 쪼갬. E-1 = 이 스프린트 (backend), E-2 = Sprint 73 (frontend).
- Sprint 73 가 `invoke("aggregate_documents", ...)` 를 호출하려면 이 스프린트 PASS 가 선행되어야 함.

## Scope Boundary

**수정 허용**:
- `src-tauri/src/db/mongodb.rs` — `aggregate` 구현 + unit 테스트 교체.
- `src-tauri/src/commands/document/query.rs` — `aggregate_documents` 커맨드 추가.
- `src-tauri/src/commands/document/mod.rs` — doc-comment 한 줄 업데이트.
- `src-tauri/src/lib.rs` — `tauri::generate_handler!` 에 `aggregate_documents` 등록.
- `src-tauri/tests/mongo_integration.rs` — `$match+$sort`, `$group` 통합 테스트 2개 추가.

**절대 수정 금지 (diff 0)**:
- `src/**` 전체 (Frontend) — Sprint 73 스코프.
- `src-tauri/src/db/mod.rs`, `src-tauri/src/db/postgres.rs` — trait/다른 paradigm 영향 없음.
- `src-tauri/src/commands/rdb/**`, `src-tauri/src/commands/connection.rs`.
- `src-tauri/src/models/**`, `src-tauri/src/error.rs`.
- `DocumentQueryResult`, `DocumentAdapter` trait 시그니처.

## Invariants

- `MongoAdapter::find`, `infer_collection_fields`, `list_databases`, `list_collections`, connect/disconnect/ping 동작 불변.
- `columns_from_docs`, `project_row`, `infer_columns_from_samples`, `bson_type_name` 헬퍼 시그니처 · 동작 불변 (aggregate 가 **소비만**).
- `DocumentQueryResult` 필드 · 순서 · 의미 불변. `total_count` 해석만 "aggregate 결과 row 수" 로 변경.
- `find_documents` Tauri 커맨드 signature 불변.
- `ActiveAdapter::as_document()`, `DocumentAdapter::aggregate` trait signature 불변 (trait 에는 이미 `aggregate` 존재).
- Rust convention 준수: `cargo fmt`, `cargo clippy -D warnings`, `unwrap()` 테스트 제외 금지, `?` 로 전파, `thiserror` 기반 `AppError` 재사용.

## Done Criteria

1. `MongoAdapter::aggregate` 가 `coll.aggregate(pipeline).await` 로 cursor 획득 후 `while let Some(next) = cursor.next().await { ... }` 로 Document 수집, `columns_from_docs` + `project_row` 로 flatten, `raw_documents` 원본 보존, `total_count = rows.len() as i64`, `execution_time_ms` = `Instant::now() → elapsed`.
2. `validate_ns(db, collection)` 이 aggregate 경로 초입에서 호출되어 빈 namespace 를 `AppError::Validation` 으로 거부.
3. 연결 전 `aggregate()` 호출은 `AppError::Connection` 반환 (find 와 동일 패턴).
4. `aggregate_documents` Tauri 커맨드가 `find_documents` 와 동일한 dispatch 패턴으로 추가 (lock → `as_document()?` → `.aggregate(...)`).
5. `lib.rs::run()` 의 `tauri::generate_handler![]` 에 `commands::document::query::aggregate_documents` 포함.
6. 단위 테스트 2개 추가, 기존 `aggregate_returns_unsupported` 삭제.
7. 통합 테스트 2개 추가 (`test_mongo_adapter_aggregate_match_sort`, `test_mongo_adapter_aggregate_group_count`), 컨테이너 없을 때 skip 패턴 재사용.
8. 6개 generator-scope check 전부 통과.
9. `git diff --stat HEAD -- src/` 빈 출력 (Frontend diff 0).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `cd src-tauri && cargo fmt --all -- --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test --lib db::mongodb` (mongodb 모듈 scope)
  4. `cd src-tauri && cargo test --test mongo_integration` (컨테이너 있으면 실제 검증, 없으면 skip)
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
- Required evidence:
  - `aggregate` 구현 시작-끝 라인 (file:line-range)
  - `aggregate_documents` command 정의 위치
  - `lib.rs::run()` 의 invoke_handler 등록 라인
  - 신규 단위 테스트 2개 이름 + 통합 테스트 2개 이름
  - `aggregate_returns_unsupported` 테스트 삭제 증거 (grep)
  - Frontend invariant: `git diff --stat HEAD -- src/` 빈 출력

## Evidence To Return

- Changed files and purpose (총 5파일 예상).
- 6개 generator-scope check 실행 커맨드 + 결과 수치 (테스트 pass 수, clippy warning 수).
- 각 AC (1~12) → 증거 파일:line 혹은 테스트 이름 매핑.
- `MongoAdapter::aggregate` 본문 스니펫 또는 file:line range.
- `aggregate_documents` command 본문 스니펫 또는 file:line.
- `lib.rs` invoke_handler 등록 라인 발췌.
- Frontend diff 0 증명 (`git diff --stat HEAD -- src/`).
- Assumptions: 빈 pipeline 시 pass-through 동작, `total_count` = rows 수 (aggregate 결과 집계), AggregateOptions 커스터마이즈 없음.
- Residual risk: 대용량 aggregate 결과 수집 시 메모리 소비. 호출자가 `$limit` 으로 제어.

## References

- Contract: `docs/sprints/sprint-72/contract.md`
- Sprint 71 handoff (Frontend 마운트 지점): `docs/sprints/sprint-71/handoff.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint E 섹션, E-1/E-2 분할)
- Relevant files (read-only reference):
  - `src-tauri/src/db/mongodb.rs` (현재 본체, aggregate 스텁 L387-398, find 구현 L299-385, helper `validate_ns`/`columns_from_docs`/`project_row`)
  - `src-tauri/src/commands/document/query.rs` (기존 `find_documents` dispatch 패턴)
  - `src-tauri/src/commands/document/mod.rs` (doc-comment)
  - `src-tauri/src/lib.rs` (AppState + `tauri::generate_handler![]` 위치)
  - `src-tauri/tests/mongo_integration.rs` (`setup_mongo_adapter` skip 패턴, `seed_client` fixture)
  - `src-tauri/src/db/mod.rs` (`DocumentAdapter::aggregate` trait signature — **read-only**)
