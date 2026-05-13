# Sprint 271 Handoff — `expected_database` propagation to RDB commands (closes Sprint 266 OoS #1)

## Status

Complete. Sprint 266 의 opt-in `expected_database` 가드 패턴을 RDB 표면 전체로
전파 — 25 commands (schema introspection 12 + query data/dry-run 2 + DDL 11)
모두 `AppError::DbMismatch { expected, actual }` 로 swap 된 pool 에서 잘못된
db 결과를 반환하지 않도록 차단. AC-271-08 의 mandatory 3-slice 분할
(271a → 271b → 271c) 각 단계가 6 verification gate (cargo fmt/clippy/test +
pnpm tsc/lint/vitest) 를 독립적으로 통과 후 commit — bisect-friendly +
review-friendly. Mongo / `cancel_query` / `verify_active_db` 는 OoS, Sprint 266
already-guarded commands (`execute_query`, `execute_query_batch`) 는
byte-equivalent.

## Slice Summary

| Slice | Commands | cargo Δ | vitest Δ | Commit |
|---|---|---|---|---|
| 271a (schema introspection) | 12 | 676 → 689 (+13) | 3232 → 3238 (+6) | `13c11ed` |
| 271b (query data + dry-run) | 2 | 689 → 695 (+6) | 3238 → 3243 (+5) | `0369b30` |
| 271c (DDL) | 11 | 695 → 708 (+13) | 3243 → 3247 (+4) | (pending) |
| **Total** | **25** | **+32** | **+15** | — |

## Acceptance Criteria — verification

| AC | 결과 (sprint roll-up) |
|---|---|
| AC-271-01 audit pinned | ✅ 25 (b) commands enumerated in contract audit table; per-slice handoffs (271a/b/c) reconcile row-by-row against actual probe sites |
| AC-271-02 backend handler accepts `expected_database` | ✅ 25 commands × probe-before-trait under `active_connections.lock()` scope. `None` path byte-equivalent. 슬라이스 handoff 의 file:line evidence 참조 |
| AC-271-03 Tauri command + TS wrapper exposes opt-in parameter | ✅ schema 12 + query 2 positional `expectedDatabase?: string`, DDL 11 `request.expectedDatabase?: string`. JSDoc Sprint 271 참조 |
| AC-271-04 callers forward active db | ✅ `schemaStore` (12 schema + 2 DDL action), `useQueryExecution` (dry-run + Sprint 266 single/batch), `DataGrid` (row fetch), `usePostgresTypes` (271a P2 fix), 8 DDL dialog/editor 모두 forward |
| AC-271-05 mismatch surfaces reuse Sprint 267 sync helper | ✅ `syncMismatchedActiveDb` 가 `src/lib/api/syncMismatchedActiveDb.ts` 로 추출 (271a). user-initiated path (Query toolbar / DataGrid / DDL dialog) 가 Sprint 269 passive toast 노출, silent path (schemaStore prefetch / autocomplete) 는 `onSynced` omit 으로 sync-only |
| AC-271-06 backend mismatch tests | ✅ 25 mismatch case + happy / none witness + cancel-release witness (271b) + create_table_plan triple-child panic 가드 (271c). 모든 trait closure 가 `panic!("must not run on mismatch")` — fail-loud guard regression |
| AC-271-07 frontend integration tests | ✅ 271a `schemaStore.dbMismatch.test.ts` 6 case, 271b `DataGrid.dbMismatch.test.tsx` 3 case + `useQueryExecution.dry-run.test.ts` +2 case, 271c `DropTableDialog.dbMismatch.test.tsx` + `CreateTableDialog.dbMismatch.test.tsx` 4 case. 모두 mocked IPC → `parseDbMismatch` → `syncMismatchedActiveDb` end-to-end |
| AC-271-08 sub-slicing | ✅ 271a → 271b → 271c 순서 commit. 각 슬라이스 단독 commit, 6 gate 독립 통과 후 advance. carry-forward 없음 |
| AC-271-09 regression gate | ✅ slice 별 6 gates green. cargo lib 676 → 708 (+32 monotonic non-decreasing), vitest 3232 → 3247 (+15 monotonic non-decreasing), tsc / lint / fmt / clippy clean on each slice and merged whole |

## Architecture summary

- **`ensure_expected_db(adapter, expected_database: Option<&str>)` helper** —
  `src-tauri/src/commands/rdb/mod.rs:50-64`. 271a 의 schema-local helper 가
  271c 단계에서 module-level 로 hoist. 23 sites (schema 12 + DDL 11) 공유.
  body 는 Sprint 266 reference (`query.rs:83-92`) 와 token-for-token
  byte-equivalent — same `unwrap_or_default()` coercion, same `AppError::DbMismatch`
  shape, trait dispatch 이전 ordering.
- **`query.rs` inline probe (4 sites)** — `execute_query` / `execute_query_batch`
  (Sprint 266) + `execute_query_dry_run` / `query_table_data` (271b). 모두
  `register_cancel_token` 후 lock guard drop **이전**에 `release_cancel_token`
  을 호출해야 하는 ordering 이 critical — helper hoist 대상 아님. premature
  abstraction 회피.
- **`cancel_query` skipped** — db-agnostic, `query_id` registry operation only.
  byte-equivalent verify.
- **Mongo / document-paradigm commands untouched** — separate adapter trait,
  별 sprint.
- **`syncMismatchedActiveDb` extraction** — 271a 에서 `useQueryExecution` 의
  inline 헬퍼를 `src/lib/api/syncMismatchedActiveDb.ts` 로 추출. `onSynced`
  callback optional — user-initiated path 는 toast 발사, silent path 는
  callback 생략. 271b / 271c 가 import 재사용.

## Out of Scope (Sprint 272+ candidates)

- **Retry button on DDL toast** — dialog Apply 버튼이 자연 retry surface 이므로
  passive `toast.warning` 충분. ref-backed retry helper 도입 안 함.
- **Mongo equivalent guard** — document adapter 는 swap surface 가 다름
  (single-db at a time). 별 trait + 별 sprint 필요.
- **`cancel_query` + `verify_active_db`** — 둘 다 db-agnostic (전자는 registry,
  후자는 canonical probe).
- **Helper hoisting for `query.rs`** — cancel-token ordering 으로 invariant 가
  schema/DDL 과 다름. Optional future cancel-aware variant 분리 후 가능하나
  current 4 sites 로는 trigger 미달.
- **TS Request interface 필드명 unification** — 271c 의 `src/types/schema.ts`
  에 `expected_database?` (snake) 와 `expectedDatabase?` (camel) mix.
  Evaluator non-blocking observation, cosmetic cleanup deferred.

## Lessons

- **Audit-first + slicing** — contract 의 audit table 이 25 sites 를 row-level
  로 미리 enumerate 한 덕에 자연스럽게 3 슬라이스로 분할 (schema/query/DDL).
  각 슬라이스가 독립 commit + 6 gate 독립 통과 → bisect-friendly + review-friendly.
  대형 propagation 작업의 default 패턴으로 굳혀야 함.
- **Helper extraction 의 적시성** — 271a 12 sites 만으로는 borderline → 271c
  의 11 sites 추가로 23 sites 가 합쳐졌을 때 `mod.rs` hoist. `query.rs` 의 4
  sites 는 cancel-token ordering invariant 가 달라 inline 유지 결정.
  Hoisting trigger 는 "site count" 만이 아니라 "invariant 일치" 도 필요 —
  premature abstraction 회피의 구체적 기준.
- **Evaluator P2 가 Generator gap 잡음** — 271a 의 `usePostgresTypes` 누락은
  Generator 가 "cache 가 connection-keyed 라 db forward 못 함" 으로 정당화
  시도했으나, contract row #12 가 명시적으로 "call site routes via (connId, db)
  ... forward `db` so a swapped pool still rejects" 라고 row-level 로 못
  박혀 있던 덕에 Evaluator 가 P2 finding 으로 catch. audit table 을 contract
  에 포함시키는 패턴이 evaluator 의 cite-able anchor — Generator 의
  case-by-case 정당화를 contract row 단위로 reject 할 수 있는 granularity 가
  catch 의 핵심.
