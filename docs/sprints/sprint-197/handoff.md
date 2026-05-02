# Sprint 197 — Handoff

Sprint: `sprint-197` (refactor — `db/mongodb.rs` 4-way split).
Date: 2026-05-02.
Status: closed.
Type: refactor (Sprint 198 토대; 행동 변경 0).

## 어디까지 했나

`src-tauri/src/db/mongodb.rs` (1809줄 monolith) 의 method body 를
4 토픽 파일로 분할하고 `mongodb.rs` 자체는 entry (모듈 선언 + trait
dispatch) 로 198 줄로 축소. modern Rust 2018+ entry pattern 채택 —
`mongodb.rs` 동일 path 유지 + `mongodb/<sub>.rs` 하위 4 파일.
`db/postgres.rs` 와 codebase 일관성 + `git log --follow` 추적 가능.

단일 `impl DocumentAdapter for MongoAdapter` 제약을 우회하기 위해
inherent `_impl` 패턴을 도입 — `mongodb.rs` 의 trait dispatch 가 토픽
파일의 `pub(super) async fn <x>_impl(...)` 을 thin wrap 한다. 행동
변경 0, 공개 API (`pub use mongodb::MongoAdapter`) 무변화.

## Files changed

| 파일 | Purpose | 라인 |
|------|---------|------|
| **MOD** `src-tauri/src/db/mongodb.rs` | 1809 → 198 줄 (-1669/+58). 모듈 declare + `pub use connection::MongoAdapter` + `impl DocumentAdapter for MongoAdapter` 9 method thin dispatch + cancel-token wrap | 198 |
| **NEW** `src-tauri/src/db/mongodb/connection.rs` | `MongoAdapter` struct + `Default` + 라이프사이클 inherent (`new` / `build_options` / `test` / `current_client` / `switch_active_db` / `current_active_db` / `resolved_db_name`) + `impl DbAdapter` + 12 connection tests | 609 |
| **NEW** `src-tauri/src/db/mongodb/schema.rs` | `_impl` (`list_databases_impl` / `list_collections_impl` / `infer_collection_fields_impl`) + 헬퍼 (`infer_columns_from_samples` / `modal_type`) + 8 schema tests | 346 |
| **NEW** `src-tauri/src/db/mongodb/queries.rs` | `_impl` (`find_impl` / `aggregate_impl`) + cursor flatten 헬퍼 (`validate_ns` / `bson_type_name` / `flatten_cell` / `columns_from_docs` / `project_row`) + 8 queries tests | 398 |
| **NEW** `src-tauri/src/db/mongodb/mutations.rs` | `_impl` (`insert_document_impl` / `update_document_impl` / `delete_document_impl`) + `DocumentId` ↔ `Bson` 헬퍼 (`document_id_to_bson` / `bson_id_to_document_id` / `describe_document_id`) + 12 mutation tests | 357 |
| **NEW** `docs/sprints/sprint-197/contract.md` | sprint contract | — |
| **NEW** `docs/sprints/sprint-197/findings.md` | entry pattern 결정 / trait split / 헬퍼 분포 / 테스트 분산 | — |
| **NEW** `docs/sprints/sprint-197/handoff.md` | 본 파일 | — |

총 코드: 1 modified + 4 created. docs 3 신설. 외부 호출자 (`db/mod.rs`,
`commands/document/*`, `commands/meta.rs`) 미수정.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-197-01 | `wc -l src-tauri/src/db/mongodb.rs src-tauri/src/db/mongodb/*.rs` | mongodb 198 / connection 609 / schema 346 / queries 398 / mutations 357 — 모두 < 700. mongodb.rs entry path 유지 (1809 → 198 modification). |
| AC-197-02 | `cargo check` | `pub use connection::MongoAdapter` 으로 외부 import 그대로. `db/mod.rs` 의 `pub mod mongodb` 는 entry-pattern 으로 `mongodb.rs` 를 해석 (modern 2018+). 0 error. |
| AC-197-03 | `cargo test --lib mongodb` | 9 trait method 모두 thin dispatch — 시그니처 동일, body 가 `Box::pin(async move { self.<x>_impl(...).await })` 또는 cancel-token wrap. 모든 기존 호출자 무수정 통과. |
| AC-197-04 | `cargo test --lib mongodb` | **45 passed / 1 ignored** (live-mongo). pre-split count 와 동일. test 30+ 가 connection (12) / schema (8) / queries (8) / mutations (12) 으로 주제별 분산. |
| AC-197-05 | `mutations.rs` inspect | inherent `impl MongoAdapter { _impl × 3 }` + 헬퍼 × 3. Sprint 198 의 3 신규 method 는 본 파일 안에서 (a) `_impl` 추가, (b) `mongodb.rs` 의 1 line dispatch 추가만으로 완료. 다른 파일 미수정. |
| Sprint 197 전체 | 4-set | **cargo fmt 0 / clippy 0 / cargo test --lib 338 passed / 2 ignored / pnpm tsc 0**. frontend 변경 0. |

## Required checks (재현)

```sh
cd src-tauri
cargo fmt -- --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --lib mongodb
cargo test --lib

cd ..
pnpm tsc --noEmit
```

기대값: cargo fmt 0 / clippy 0 / mongodb 45 passed (1 ignored) / 전체
338 passed (2 ignored) / tsc 0.

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- `pub use mongodb::MongoAdapter` 경로는 `db/mod.rs` → `db::MongoAdapter`
  로 그대로 노출. 외부 호출 코드 패턴 변경 없음.
- 새 `_impl` 메서드를 추가할 때:
  1. 토픽 파일의 inherent `impl MongoAdapter { ... }` 안에
     `pub(super) async fn <name>_impl(&self, ...) -> Result<...>`.
  2. `mongodb.rs` 의 `impl DocumentAdapter for MongoAdapter` 에
     cancel-token wrap 또는 thin dispatch 1 줄 추가.
- cross-module 헬퍼 (예: `bson_type_name`): `pub(super)` 으로 같은 mod
  내부 쪽 가시성 유지, `use super::queries::<helper>` 로 import.

### 회귀 가드

- `cargo test --lib mongodb` — 45 case 분산 중.
  (connection 12 / schema 8 / queries 8 / mutations 12 + helpers 5 +
  ignored 1).
- 외부 호출자 무수정 — `db/mod.rs` / `commands/document/*` /
  `commands/meta.rs` 의 import 그대로.
- frontend 변경 0 — `pnpm vitest run` 187 files / 2719 tests 무영향.

### 후속

- **Sprint 198 (FB / Mongo bulk-write 3 신규 command)** —
  `mutations.rs` 안에서 (a) `delete_many_impl` / `update_many_impl` /
  `drop_collection_impl` `_impl` 추가, (b) `DocumentAdapter` trait 자체
  확장 + `mongodb.rs` dispatch 추가, (c) UI 진입점 결정 +
  `analyzeMongoOperation` analyzer.

### 외부 도구 의존성

없음. 추가 crate 0. 기존 `mongodb` / `bson` / `tokio_util::sync` 만 사용.

### 폐기된 surface

- 없음. 모든 public API 유지. inherent `_impl` 추가는 `pub(super)` 라
  외부에서 보이지 않으므로 surface 변화 0.

## 시퀀싱 메모

- Sprint 191 (SchemaTree decomposition) → Sprint 192 (DB export) →
  Sprint 193 (useDataGridEdit decomposition) → Sprint 194 (FB-4 Quick
  Look edit) → Sprint 195 (tabStore intent actions) → Sprint 196
  (FB-5b history source) → **Sprint 197** (mongodb.rs 4-way split).
- 다음 — Sprint 198 (Mongo bulk-write 3 신규 command), Sprint 197 의
  mutations.rs 가 토대.

## Refs

- `docs/sprints/sprint-197/contract.md` — sprint contract.
- `docs/sprints/sprint-197/findings.md` — 결정 / 결과 / 트레이드오프.
- `docs/refactoring-plan.md` Sprint 197 row.
- `docs/refactoring-smells.md` §9 (Rust 대형 모듈 — `db/mongodb.rs`
  체크박스 close).
