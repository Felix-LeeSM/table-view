# Sprint Execution Brief: sprint-308 (Phase 28 Slice A2 — backend command surface)

## Objective

Phase 28 Slice A1 (mongosh 파서) 가 dispatch 할 backend wire 를 완성한다.
`DocumentAdapter` trait 에 6 신규 method 를 추가하고, `MongoAdapter` 가 이를
live driver 에 대해 구현하며, 6 신규 Tauri command + TS wrapper + 테스트를
모두 갖춘다. **Mongo 측 trait/impl/IPC + TS wrapper 만 — editor / store /
dispatch 변경은 없음.**

신규 메서드:
- read: `find_one`, `count_documents`, `estimated_document_count`, `distinct`
- write: `insert_many`, `bulk_write`

## Task Why

A2 는 A1 의 파서가 호출할 backend dispatch 표면이다. 13-method whitelist 중
기존 IPC 가 커버하지 않는 6 메서드 (`findOne` / `countDocuments` /
`estimatedDocumentCount` / `distinct` / `insertMany` / `bulkWrite`) 를 wire
하지 않으면 A5/A6 의 Run dispatch 가 절반 method 에서 fall-through 한다.
또한 `bulkWrite` 은 13 method 의 maximum complexity 점이라 wire shape
(`BulkWriteOp` enum + `BulkWriteResult` 카운터)을 명확히 잡아두지 않으면 후속
sprint 에서 frontend dispatch 가 잘못된 가정으로 설계될 위험이 있다.

Phase 28 grill (`memory/roadmap/phase-28-mongo-full-support/memory.md`):
- 13-method whitelist 가 frozen — A2 는 그 중 새로 IPC 가 필요한 6 개를
  커버.
- BSON canonical-extjson shape 도 frozen — 신규 method 의 결과는 기존
  `flatten_cell` 을 거친 동일 shape 으로 반환.

## Scope Boundary

**Touch**:
- `src-tauri/src/db/traits.rs` (MODIFY)
- `src-tauri/src/db/types.rs` (MODIFY — 신규 type 추가)
- `src-tauri/src/db/testing.rs` (MODIFY — `StubDocumentAdapter` 확장)
- `src-tauri/src/db/mongodb/queries.rs` (MODIFY — 4 read impl)
- `src-tauri/src/db/mongodb/mutations.rs` (MODIFY — 2 write impl)
- `src-tauri/src/commands/document/query.rs` (MODIFY — 4 신규 command)
- `src-tauri/src/commands/document/mutate.rs` (MODIFY — 2 신규 command)
- `src-tauri/src/lib.rs` (MODIFY — `generate_handler!` 등록)
- `src-tauri/tests/mongo_integration.rs` (MODIFY — 신규 scenario)
- `src/lib/tauri/document.ts` (MODIFY — 6 wrapper)
- `src/types/document.ts` (MODIFY — `DocumentRow` 등)
- `src/types/documentMutate.ts` (MODIFY 또는 NEW — `BulkWriteOp`/`BulkWriteResult`)
- 해당 `*.test.ts` 또는 인-파일 `#[cfg(test)] mod tests` 신규 단위 테스트

**DO NOT touch**:
- `src/components/` 어떤 파일이든
- `src/stores/`, `src/hooks/`
- `src-tauri/src/commands/rdb/`, `src-tauri/src/db/postgres/` 등 RDB code path
- `src/lib/mongo/mongoshParser.ts` (A1 산출물, 동결)
- 기존 mongo command (`find_documents`, `aggregate_documents`,
  `insert_document`, `update_document`, `delete_document`, `update_many`,
  `delete_many`, `drop_collection`) 의 시그니처
- `tab.queryMode` 관련 어떤 코드 (그건 A3 의 범위)

scope 밖 touch 가 필요해 보이면 STOP — assumption 으로 surface.

## Invariants

- **No `unwrap()` outside tests** — `?` / `ok_or_else` / `map_err` 사용.
- **Cancel cooperation** — read-path 4 method 는 `find` / `aggregate` 와
  동일한 `tokio::select!` 패턴.
- **`AppError` shape** — RDB 거부 = `AppError::Unsupported`, 미존재
  connection = `AppError::NotFound`, 빈 db/coll = `AppError::InvalidInput`
  (기존 `validate_ns` 동등).
- **canonical-extjson 호환** — `DocumentRow` 의 cell 은 기존 `flatten_cell`
  helper 를 통해 동일 shape (`$oid` / `$date` / `$binary` / `$numberLong` /
  `$numberDecimal`) 으로 직렬화.
- **`BulkWriteOp` serde** — `#[serde(tag = "op", rename_all = "camelCase")]`
  + variant 이름 `InsertOne` / `UpdateOne` / `UpdateMany` / `DeleteOne` /
  `DeleteMany` / `ReplaceOne`. Wire JSON: `{ "op": "updateOne", "filter":
  {...}, "update": {...} }`.
- **TS no `any`** — `unknown` + type guard.
- **Convention discipline** — `.claude/rules/rust-conventions.md`,
  `.claude/rules/react-conventions.md`, `.claude/rules/testing.md`.
- **TDD discipline** — vertical slice 로 진행. 한 trait method 당 (1)
  trait signature 추가 → 컴파일 → (2) `MongoAdapter` impl → unit test 또는
  integration scenario 1 개로 GREEN → (3) command + TS wrapper → 다음 method.
  6 method 모두를 한꺼번에 declare 한 뒤 일괄 구현 금지.

## Done Criteria

1. `cargo check -p table-view` exit 0.
2. `cargo build -p table-view` exit 0.
3. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
4. `cargo fmt --check` exit 0.
5. `cargo test -p table-view --lib commands::document` exit 0, 6 신규 command
   각각 3 거부 케이스 + 1 happy path = 최소 24 test 통과.
6. `cargo mongo-test` exit 0 — 신규 testcontainers scenario 6개 PASS,
   기존 scenario 회귀 0.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `pnpm vitest run` exit 0 — full suite. Sprint-307 baseline 3491 passed /
   10 skipped 대비 회귀 0.
10. 신규 Rust 라인 커버리지 ≥80% (`cargo llvm-cov` 보고서로 인용).
11. 6 신규 Tauri command 가 `tauri::generate_handler![…]` 에 등록되어 있음
    (grep 으로 검증).
12. `src/lib/tauri/document.ts` 에 6 wrapper export 가 추가되어 있고 각각
    `invoke<T>(…)` 호출.
13. 신규 파일/블록 헤더에 Sprint 308 마커 + 이유 1줄
    (`feedback_test_documentation.md`).

## Verification Plan

- **Profile**: `command + api`
- **Required checks**:
  1. `cargo check -p table-view` exit 0
  2. `cargo build -p table-view` exit 0
  3. `cargo clippy --all-targets --all-features -- -D warnings` exit 0
  4. `cargo fmt --check` exit 0
  5. `cargo test -p table-view --lib commands::document` exit 0
  6. `cargo mongo-test` exit 0
  7. `pnpm tsc --noEmit` exit 0
  8. `pnpm lint` exit 0
  9. `pnpm vitest run` exit 0
  10. `cargo llvm-cov` 신규 모듈 line ≥80%

- **Required evidence**:
  - 각 신규 trait method 의 정확한 시그니처
  - 각 신규 command 의 이름 + arg key 목록 (Rust + TS 양쪽 일치)
  - `cargo mongo-test` 의 신규 scenario 이름 + PASS 출력
  - 커버리지 % (보고서 라인 인용)
  - `git diff --name-only` 스냅샷

## Evidence To Return

- **Changed files and purpose** — list `<path>: <one-line purpose>`.
- **Checks run and outcomes** — exit code + key metric line for each of the
  10 required checks.
- **Done criteria coverage with evidence** — for each of the 13 done
  criteria, the test name / command / file path that proves it.
- **Assumptions made during implementation** — e.g. "`insert_many([])` 는
  driver 에러 대신 `inserted_ids: []` 반환 — driver behaviour 가 그렇게
  나오면 그대로, 아니면 wrap" 같은 결정.
- **Residual risk or verification gaps** — A5/A6 가 노출되어야 끝나는 표면
  (예: `find_one` 의 grid/scalar 렌더링 분기는 A6 에서 확정).

## TDD Workflow Reminder (per `.agents/skills/tdd`)

Vertical slice — 한 메서드씩 RED→GREEN:

1. **Plan** — 6 메서드 × 4 케이스 (rdb 거부 / not-found / invalid-input /
   happy) = 24 단위 테스트 + 6 integration scenario. tracer bullet =
   `find_one` (가장 단순, 가장 가까운 기존 패턴 = `find`).
2. **Tracer bullet** — `find_one` 의 RED unit test 1 개 (rdb 거부) → trait
   signature + 빈 MongoAdapter impl + command stub + handler 등록 → GREEN.
3. **Incremental vertical slices** — `find_one` 4 케이스 모두 GREEN 한 뒤
   `count_documents`, 다음 `estimated_document_count`, `distinct`,
   `insert_many`, 마지막에 가장 복잡한 `bulk_write`. 각 메서드의 integration
   scenario 도 그 method 가 unit GREEN 된 직후에 추가.
4. **Refactor only on GREEN** — 6 메서드 모두 GREEN 한 뒤 공통 패턴
   (`validate_ns`, `as_document()?` 게이트) 이 중복되면 helper 로 추출. RED
   중에는 추상화 금지.

가로 슬라이싱 금지: 6 trait method 를 한 번에 declare 한 뒤 모든 impl 을
한 번에 쓰지 말 것. 한 번에 한 메서드씩.

## References

- **Contract**: `docs/sprints/sprint-308/contract.md`
- **Slice A 마스터 spec**: `docs/sprints/sprint-307/spec.md` (A2 섹션)
- **Sprint A1 산출물** (consumed): `src/lib/mongo/mongoshParser.ts`,
  `memory/decisions/0029-mongosh-parser-strategy/memory.md`
- **Phase 정의서**: `docs/phases/phase-28.md`
- **Grill 결정**: `memory/roadmap/phase-28-mongo-full-support/memory.md`
- **기존 mongo command 패턴**: `src-tauri/src/commands/document/query.rs`
  (`find_documents`), `src-tauri/src/commands/document/mutate.rs`
  (`update_document`)
- **기존 mongo adapter impl 패턴**: `src-tauri/src/db/mongodb/queries.rs`
  (`find_impl`, `aggregate_impl`), `src-tauri/src/db/mongodb/mutations.rs`
  (`update_many`, `delete_many`)
- **`flatten_cell` (canonical-extjson)**: `src-tauri/src/db/mongodb/queries.rs`
- **기존 통합 테스트**: `src-tauri/tests/mongo_integration.rs`
- **Conventions**: `.claude/rules/rust-conventions.md`,
  `.claude/rules/react-conventions.md`, `.claude/rules/testing.md`
