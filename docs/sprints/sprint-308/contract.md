# Sprint Contract: sprint-308 (Phase 28 Slice A2 — backend command surface)

## Summary

- Goal: `DocumentAdapter` trait + `MongoAdapter` 구현체 + Tauri command 표면에
  6 신규 메서드 추가 (`find_one`, `count_documents`,
  `estimated_document_count`, `distinct`, `insert_many`, `bulk_write`).
  Sprint A1 의 mongosh 파서가 dispatch 할 backend wire 를 완성.
- Audience: Phase 28 Slice A (mongosh editor) — A5/A6 의 dispatch surface 가 곧
  consume.
- Owner: Generator agent (general-purpose subagent_type)
- Verification Profile: `command + api`

## In Scope

- `src-tauri/src/db/traits.rs` — `DocumentAdapter` 에 6 trait method 추가
  (cancel-token cooperation 은 `find` 와 동일 패턴).
- `src-tauri/src/db/types.rs` — 신규 타입 추가:
  - `DocumentRow` (단일 문서 projection 결과; `columns: Vec<String>` + `row:
    Vec<serde_json::Value>` shape)
  - `BulkWriteOp` (`InsertOne` / `UpdateOne` / `UpdateMany` / `DeleteOne` /
    `DeleteMany` / `ReplaceOne` variant 의 tagged enum, `serde(tag = "op")`)
  - `BulkWriteResult` (집계 카운터 + `upserted_ids: Vec<DocumentId>`)
- `src-tauri/src/db/mongodb/queries.rs` — 4 read-path impl
  (`find_one_impl`, `count_documents_impl`, `estimated_document_count_impl`,
  `distinct_impl`) 및 trait wiring.
- `src-tauri/src/db/mongodb/mutations.rs` — 2 write-path impl
  (`insert_many_impl`, `bulk_write_impl`) 및 trait wiring.
- `src-tauri/src/db/testing.rs` — `StubDocumentAdapter` 에 6 메서드 stub 추가
  (기존 테스트 컴파일 유지).
- `src-tauri/src/commands/document/query.rs` — 4 신규 Tauri command:
  `find_one_document`, `count_documents`, `estimated_document_count`,
  `distinct_documents`.
- `src-tauri/src/commands/document/mutate.rs` — 2 신규 Tauri command:
  `insert_many_documents`, `bulk_write_documents`.
- `src-tauri/src/lib.rs` — 6 command 를 `tauri::generate_handler![…]` 에 등록.
- `src-tauri/tests/mongo_integration.rs` — 6 신규 testcontainers scenario 추가
  (insertMany → countDocuments → distinct → findOne → bulkWrite → 최종 state
  검증).
- `src/lib/tauri/document.ts` — 6 TS invoke wrapper.
- `src/types/document.ts` + `src/types/documentMutate.ts` — Rust 측 신규
  타입과 동일 shape 의 TS 타입 + Vitest 단위 테스트 (round-trip 직렬화).

## Out of Scope

- 프론트엔드 editor / store / dispatch (A3 / A5 / A6).
- 신규 BSON literal 처리는 A1 파서에서 이미 완료 — 백엔드는 canonical-extjson
  shape 만 수용.
- `bulkWrite` 의 `ordered: bool` flag — Mongo driver 기본값(`true`)로 고정.
  사용자 노출은 A6 의 WriteSummaryPanel 에서 후속 결정.
- `find_one_document` 가 단일 row 를 grid 로 보여줄지 scalar panel 로 보여줄지의
  렌더링은 A6 에서 결정. A2 는 wire shape 만 확정.
- `aggregate` / `find` / 기존 mutation command 는 건드리지 않음.

## Invariants

- **Frozen 13-method whitelist** — A1 의 `MONGOSH_METHOD_WHITELIST` 를 single
  source of truth 로 받는다. 백엔드는 이 list 외 method 이름을 노출하지 않는다.
- **Cancel token cooperation** — read-path 4 method 는 `find` / `aggregate` 와
  동일하게 `cancel: Option<&CancellationToken>` 인자를 받고 `tokio::select!`
  패턴 으로 cooperative abort 한다. write-path 2 method 는 cancel 불필요
  (mongo driver 자체가 write 중단을 지원하지 않음) — TSDoc 에 명시.
- **`as_document()?` 게이트** — 신규 command 4 read + 2 write 모두 RDB
  paradigm 호출 시 `AppError::Unsupported`, 존재하지 않는 connection id
  호출 시 `AppError::NotFound`, 빈 db/collection 호출 시 `AppError::InvalidInput`
  (또는 `validate_ns` 등가) 를 즉시 반환.
- **No JS eval / no `unwrap()`** — Rust 측 `cargo clippy -D warnings` 통과.
  `unwrap()` 은 테스트 코드에서만 허용.
- **No `any` in TypeScript** — `src/lib/tauri/document.ts`, `src/types/*`
  새 코드는 `unknown` + 좁히기.
- **canonical-extjson 호환** — `find_one` / `bulk_write` 결과의 BSON cell
  flatten 은 기존 `flatten_cell`(queries.rs) 동일 helper 를 거친다.
- **Rdb regression zero** — `cargo test --test query_integration`, `cargo
  test --lib commands::rdb`, `pnpm test src/components/query/SqlQueryEditor`
  exit 0.
- **Existing Mongo integration regression zero** — `cargo mongo-test`
  (testcontainers gate) 의 기존 scenario 통과 수가 베이스라인과 동일하거나
  증가.

## Acceptance Criteria

- `AC-01` — `DocumentAdapter` trait 에 6 메서드가 등록되고, `MongoAdapter`
  가 6 메서드를 구현. `cargo check -p table-view` exit 0.
- `AC-02` — 6 신규 Tauri command 가 존재하고 `tauri::generate_handler!`
  매크로에 등록됨. `cargo build` exit 0.
- `AC-03` — 각 신규 command 의 단위 테스트 (mocked adapter, 또는
  `StubDocumentAdapter` 변형) 가:
  - RDB paradigm → `AppError::Unsupported`
  - 미존재 connection id → `AppError::NotFound`
  - 빈 db / collection → `AppError::InvalidInput` (또는 `validate_ns`
    표준 에러)
  의 3 거부 경로를 모두 assert.
- `AC-04` — `src-tauri/tests/mongo_integration.rs` 의 신규 시나리오가
  testcontainers Mongo 에 대해:
  - `insert_many` 로 N(=5) 문서 삽입 → `inserted_ids.len() == N`
  - `count_documents({})` == N, `estimated_document_count()` ≥ N
  - `distinct("field", filter)` → 기대 unique value set
  - `find_one(filter)` → 단일 문서 columns/row 반환
  - `bulk_write([insertOne, updateOne, deleteOne])` → 카운터 합치
  의 sequence 를 검증. `cargo mongo-test` exit 0.
- `AC-05` — `src/lib/tauri/document.ts` 에서 6 TS wrapper 가 export 되고
  `await invoke<T>(...)` shape 으로 호출. Rust 측 command 이름(snake_case)과
  arg key 가 일치. round-trip 직렬화 vitest (`*.test.ts`) 통과.
- `AC-06` — `BulkWriteOp` / `BulkWriteResult` / `DocumentRow` TS 타입이
  Rust 측과 1:1 대응. `pnpm tsc --noEmit` exit 0.
- `AC-07` — `cargo clippy --all-targets --all-features -- -D warnings`
  exit 0, `cargo fmt --check` exit 0.
- `AC-08` — `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0, `pnpm vitest run`
  (full) exit 0 (no regression vs sprint-307 baseline 3491 passed).
- `AC-09` — 신규 Rust 코드 라인 커버리지 ≥80% (DbAdapter 구현체 기준,
  `.claude/rules/testing.md`). `cargo llvm-cov --html --output-dir
  target/llvm-cov` 또는 `cargo mongo-coverage` 의 보고서로 인용.
- `AC-10` — 신규 파일 헤더 (Rust/TS 양쪽) 에 `Sprint 308` + 작성 이유 한 줄
  포함 (`feedback_test_documentation.md`).

## Design Bar / Quality Bar

- 기존 `find` / `aggregate` impl 의 cancel + error 패턴을 그대로 답습 — 신규
  helper 함수, 신규 lifetime 도입 금지.
- `BulkWriteOp` enum 직렬화는 `#[serde(tag = "op", rename_all =
  "camelCase")]` 로 frontend(`{ op: "updateOne", filter: {...}, update:
  {...} }`) shape 과 직접 호환.
- `DocumentRow` 의 column ordering 은 `flatten_cell` 의 BFS 순서를 따른다
  (DocumentQueryResult 와 동일).

## Verification Plan

### Required Checks

1. `cargo check -p table-view` exit 0.
2. `cargo build -p table-view` exit 0.
3. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
4. `cargo fmt --check` exit 0.
5. `cargo test -p table-view --lib commands::document` exit 0 (또는 동등한
   범위 — 6 신규 command 단위 테스트가 포함되는 build target).
6. `cargo mongo-test` exit 0 (testcontainers gate, 신규 integration
   scenario 포함).
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `pnpm vitest run` exit 0 (전체) — sprint-307 baseline 3491 passed
   대비 회귀 0.
10. `grep -rn "queryMode" src/lib/tauri/document.ts src/types/document.ts
    src/types/documentMutate.ts` empty (이 sprint 에서 추가되는 wire 표면은
    queryMode 와 무관).

### Required Evidence

- Generator must provide:
  - 신규/수정된 파일 목록 + 각 줄의 목적
  - 6 신규 trait method 의 시그니처 (정확히 정의된 그대로)
  - 6 신규 Tauri command 의 이름 + arg key 목록
  - `cargo mongo-test` 출력의 신규 scenario 명 + pass 결과
  - `cargo llvm-cov` 또는 `cargo mongo-coverage` 의 신규 모듈 line %
  - `git diff --name-only` 스냅샷 (scope 외 파일 미수정 증명)
- Evaluator must cite:
  - 각 AC 의 evidence (test name / file path / 커버리지 % / clippy 출력)
  - testcontainers 환경에서 6 scenario 가 실제 mongo 에 대해 통과했는지
  - frontend regression 0 (vitest baseline 매치)

## Test Requirements

### Unit Tests (필수)
- 6 신규 command 별 단위 테스트 (rdb 거부 / not-found / invalid-input / happy
  path 4 케이스 minimum)
- `BulkWriteOp` serde round-trip (각 variant 1 회 이상)
- TS 타입 round-trip — Rust 측 `serde_json::to_string` 출력을 fixture 로
  넣고 TS 측 `JSON.parse` + 타입 가드 통과 확인

### Coverage Target
- 신규 Rust 코드: 라인 80% 이상 (DbAdapter 구현체 기준)
- 신규 TS 코드: 라인 70% 이상 (Tauri wrapper 는 thin layer 라 함수 호출 시그니처
  검증으로 충분)

### Scenario Tests (필수)
- [x] Happy path — testcontainers Mongo 에 대한 insertMany → count → distinct
  → findOne → bulkWrite sequence
- [x] 에러/예외 — RDB paradigm, 미존재 connection, 빈 db/collection 3 거부
- [x] 경계 조건 — `insert_many([])` (빈 배열) 동작 정의 (현 spec:
  `inserted_ids: []` 반환, 에러 없음. driver 가 거부하면 그 에러 surface).
  `bulk_write([])` 도 동일하게 빈 카운터 결과 반환.
- [x] 기존 기능 회귀 없음 — `cargo mongo-test` 의 sprint-198 / sprint-307
  scenario count 가 줄지 않음.

## Test Script / Repro Script

```bash
# 1. Rust 빌드 + 정적 검증
cargo check -p table-view
cargo clippy --all-targets --all-features -- -D warnings
cargo fmt --check

# 2. 단위 테스트
cargo test -p table-view --lib commands::document

# 3. testcontainers 통합 (Docker 필요)
cargo mongo-test

# 4. 프론트엔드 빌드 + 회귀
pnpm tsc --noEmit
pnpm lint
pnpm vitest run

# 5. 커버리지
cargo llvm-cov --html --output-dir target/llvm-cov
# 또는
cargo mongo-coverage
```

## Ownership

- Generator: general-purpose Agent (Plan-Generator-Evaluator separation 유지)
- Write scope: `src-tauri/src/db/{traits,types,testing}.rs`,
  `src-tauri/src/db/mongodb/{queries,mutations}.rs`,
  `src-tauri/src/commands/document/{query,mutate}.rs`, `src-tauri/src/lib.rs`,
  `src-tauri/tests/mongo_integration.rs`, `src/lib/tauri/document.ts`,
  `src/types/document.ts`, `src/types/documentMutate.ts`, +해당 테스트 파일들.
- Merge order: A2 → A3 → A4 → A5 → A6 (spec 상 sequence 고정)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`
