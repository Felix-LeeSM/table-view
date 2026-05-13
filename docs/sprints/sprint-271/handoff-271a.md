# Sprint 271a Handoff — Schema introspection `expected_database` guard

## Status

Complete. Sprint 271 의 첫 슬라이스 (3 of 3 중 1번) — Sprint 266 의
`expected_database` 가드 패턴을 `commands/rdb/schema.rs` 의 12 introspection
command 에 전파. probe block 은 Sprint 266 reference (`query.rs:83-92`) 와
byte-equivalent 한 `ensure_expected_db(adapter, expected_database)` 헬퍼로
추출 — `active_connections.lock()` 동일 scope, `unwrap_or_default()` 동일
coercion, `AppError::DbMismatch { expected, actual }` 동일 shape, trait dispatch
이전 ordering. Sprint 267 의 inline `syncMismatchedActiveDb` 를
`src/lib/api/syncMismatchedActiveDb.ts` 로 추출 — caller 2개 (`useQueryExecution`
+ `schemaStore`) 이지만 `schemaStore` 가 10+ method 에서 호출하므로 사실상 N
callers. Evaluator 가 P2 로 catch 한 `usePostgresTypes` 가드 누락
(contract row #12 명시) 은 post-evaluation 에서 `resolveActiveDb(connectionId)`
forwarding 으로 fix.

## Audit Table

12 commands marked (b) + 1 (c) skip (`cancel_query`, db-agnostic). probe 는
모두 `ensure_expected_db(adapter, expected_database).await?` 통과 — trait
method 호출 직전 위치.

| # | Command | Backend probe site | Frontend wrapper | Caller updated | Test added |
|---|---|---|---|---|---|
| 1 | `list_schemas` | `schema.rs:59` | `schema.ts` `listSchemas` | `schemaStore.ts:282` | `schema.rs:1027` |
| 2 | `list_tables` | `schema.rs:90` | `schema.ts` `listTables` | `schemaStore.ts:296`, `useSchemaTableMutations.ts:62,106` | `schema.rs:1043` |
| 3 | `get_table_columns` | `schema.rs:127` | `schema.ts` `getTableColumns` | `schemaStore.ts:339` | `schema.rs:1057` (+ `:1073` cancel-release) |
| 4 | `list_schema_columns` | `schema.rs:175` | `schema.ts` `listSchemaColumns` | `schemaStore.ts:476` | `schema.rs:1087` |
| 5 | `get_table_indexes` | `schema.rs:212` | `schema.ts` `getTableIndexes` | `schemaStore.ts:362` | `schema.rs:1101` |
| 6 | `get_table_constraints` | `schema.rs:264` | `schema.ts` `getTableConstraints` | `schemaStore.ts:371` | `schema.rs:1115` |
| 7 | `list_views` | `schema.rs:315` | `schema.ts` `listViews` | `schemaStore.ts:309` | `schema.rs:1129` |
| 8 | `list_functions` | `schema.rs:347` | `schema.ts` `listFunctions` | `schemaStore.ts:321` | `schema.rs:1143` |
| 9 | `get_view_definition` | `schema.rs:380` | `schema.ts` `getViewDefinition` | `schemaStore.ts:389` | `schema.rs:1157` |
| 10 | `get_view_columns` | `schema.rs:415` | `schema.ts` `getViewColumns` | `schemaStore.ts:380` | `schema.rs:1171` |
| 11 | `get_function_source` | `schema.rs:450` | `schema.ts` `getFunctionSource` | (schemaStore 내부) | `schema.rs:1185` |
| 12 | `list_postgres_types` | `schema.rs:483` | `schema.ts` `listPostgresTypes` | `usePostgresTypes.ts:198` (P2 fix) | `schema.rs:1199` |
| — | `cancel_query` | (no change) | (no change) | (no change) | (no change) — (c) skip, db-agnostic |

## Acceptance Criteria — verification

| AC | 결과 (271a 한정) |
|---|---|
| AC-271-01 audit pinned | ✅ 12 commands (b) + 1 (c). 위 table 이 fixed enumeration |
| AC-271-02 backend handler accepts `expected_database` | ✅ 12 commands × `Option<String>` last-positional + shared `ensure_expected_db` helper (`schema.rs:33-47`). `None` path byte-equivalent — early return skip |
| AC-271-03 TS wrapper + JSDoc | ✅ `src/lib/tauri/schema.ts` 12 export 가 `expectedDatabase?: string` 수용, `expected_database: expectedDatabase ?? null` forward. 모듈 JSDoc + 인라인 docs Sprint 271 참조 |
| AC-271-04 callers forward active db | ✅ `schemaStore.ts` 10 method + `useSchemaTableMutations.ts` 2 site + **`usePostgresTypes.ts:198` (post-evaluation fix — `resolveActiveDb(connectionId)` forwarding)**. Evaluator P2 finding 닫음 |
| AC-271-05 sync helper reuse | ✅ `syncMismatchedActiveDb` 를 `src/lib/api/syncMismatchedActiveDb.ts` 로 추출. `useQueryExecution` (Retry toast) + `schemaStore` (silent, `onSynced` omit) 양쪽 import |
| AC-271-06 backend mismatch tests | ✅ 12 per-command mismatch test + 1 cancel-release witness + 2 happy/none witness. trait closure 가 `panic!("must not run on mismatch")` — guard regression fail-loud |
| AC-271-07 frontend integration test | ✅ `schemaStore.dbMismatch.test.ts` (NEW, 6 cases) — loadSchemas / loadTables / getTableColumns / getTableIndexes / prefetchSchemaColumns + non-mismatch negative. `toast.warning` NOT called assertion 으로 silent invariant 박제 |
| AC-271-08 sub-slicing | ✅ slice 1 of 3. 271b / 271c 미착수. 본 슬라이스 단독 commit |
| AC-271-09 regression gate | ✅ 6 gates green. cargo lib 676→689 (+13), vitest 3232→3238 (+6), tsc / lint / fmt / clippy clean |

## 주요 production 변경

| 카테고리 | 파일 | 변경 |
|---|---|---|
| (a) backend probe | `src-tauri/src/commands/rdb/schema.rs` | 12 commands 각각 `expected_database: Option<String>` last-positional 수용 + `_inner` 헬퍼 `Option<&str>` 수용 + 새 `ensure_expected_db` 헬퍼 (`:33-47`). 15 신규 `#[tokio::test]` 케이스 |
| (b) frontend wrapper | `src/lib/tauri/schema.ts` | 12 export 모두 `expectedDatabase?: string` last-positional 추가, `expected_database: expectedDatabase ?? null` forward. JSDoc Sprint 271 참조 |
| (c) caller forwarding | `src/stores/schemaStore.ts` (10 method), `src/hooks/useSchemaTableMutations.ts` (2 site), `src/hooks/usePostgresTypes.ts` (1 site — P2 fix) | `(connId, db)` 또는 `resolveActiveDb(connId)` forwarding. schemaStore catch 는 `syncMismatchedActiveDb` 를 `onSynced` 없이 호출 (silent 백그라운드) |
| (d) helper extraction | `src/lib/api/syncMismatchedActiveDb.ts` **(NEW)**, `src/components/query/QueryTab/useQueryExecution.ts` (1줄 import) | Sprint 267 inline 헬퍼를 모듈로 추출. `useQueryExecution` 은 inline 삭제 후 import 1줄. behaviour byte-equivalent, `onSynced` optional |

## 테스트

### Backend (cargo) — 676 → 689 (+13)

`src-tauri/src/commands/rdb/schema.rs::mod tests`:
- 12 × `*_expected_db_mismatch_returns_dbmismatch_and_skips_trait` — stub
  adapter `current_database = Some("dbA")`, caller `Some("dbB")` →
  `Err(AppError::DbMismatch { expected: "dbB", actual: "dbA" })`. trait
  closure 가 `panic!` 이라 guard regression 은 fail-loud.
- 1 × `get_table_columns_mismatch_releases_cancel_token` (`:1073`) —
  Sprint 266 의 cancel-token-after-mismatch 패턴 검증.
- 2 × happy/none witness — match path 정상 dispatch + `None` path 가
  `current_database` probe 자체를 skip 함을 검증.

### Frontend (vitest) — 3232 → 3238 (+6)

`src/stores/schemaStore.dbMismatch.test.ts` **(NEW, 6 cases)**:
mocked IPC 가 Sprint 266 wire format 으로 throw → `parseDbMismatch`
recognise → `syncMismatchedActiveDb` → `setActiveDb("conn1", "dbB")` 동기 +
`toast.warning` NOT called assertion. 케이스: `loadSchemas`, `loadTables`,
`getTableColumns`, `getTableIndexes`, `prefetchSchemaColumns` (silent
best-effort), non-mismatch-no-sync negative.

### P2 fix 후 assertion 업데이트 (post-evaluation)

- `src/hooks/usePostgresTypes.test.ts` — IPC 호출 시그니처 검증에
  `resolveActiveDb(connectionId)` 인자 추가.
- `src/components/schema/CreateTableDialog.test.tsx` — type-list fetch
  spy 의 `expectedDatabase` argument assertion 추가.

기존 `schemaStore.test.ts` (4 assertion), `useSchemaTableMutations.test.ts`
(2 assertion) 은 새 positional arg 반영 update — rewrite 아님.

## Out of Scope (this slice)

- **Sprint 271b** — query data + dry-run (`execute_query_dry_run`,
  `query_table_data`). `useQueryExecution` dry-run + `DataGrid` row-fetch
  caller forwarding. 별 commit.
- **Sprint 271c** — DDL 11 commands (`*Request` struct 에
  `#[serde(default)] expected_database: Option<String>` 필드). DDL dialog
  driver caller forwarding + Retry toast 재사용. 별 commit.
- **`cancel_query`** — db-agnostic skip (operates on `query_id` registry,
  not adapter pool). byte-equivalent verify.
- **Mongo / document-paradigm commands** — separate adapter trait, 별 sprint.
- **Sprint 266 already-guarded commands** — `execute_query`,
  `execute_query_batch` byte-equivalent. `git diff main -- query.rs` 0 lines
  for these handlers.

## Lessons

- **Probe helper 추출** — 12 곳 copy-paste 회피. Sprint 266 의 inline 6-line
  probe 패턴이 충분히 stable 했기에 helper 로 1차 abstraction 가능. 핵심은
  Sprint 266 가 이미 production 에서 검증된 byte-equivalent reference 를
  남겨놨다는 것 — 새 패턴 발명이 아니라 검증된 패턴의 N-place propagation.
  helper extraction 의 정당화 timing 은 "원본이 stable + 추가 site ≥3" 일 때.
- **Sync helper 추출 시점 — caller count 의 module-vs-site 모호성** —
  `useQueryExecution` 1 module, `schemaStore` 1 module = 2 callers 로 보면
  contract 의 "3+" 기준 미달. 하지만 `schemaStore` 가 `handleDbMismatch`
  helper 를 통해 10+ method 에서 호출 → 사실상 N callers. Borderline 에서
  extraction 정당화 기준은 caller module 수가 아니라 "동일 inline 사본이
  diverge 할 위험" — schemaStore 의 10 site 가 inline 이었으면 catch 분기
  drift 가 불가피했다.
- **Evaluator catch — contract row 가 catch 의 핵심** — Generator 가
  `usePostgresTypes` 를 "cache 가 connection-keyed 라서 db forward 못 함"
  으로 예외 처리 → Evaluator 가 P2 finding (contract row #12 가 명시:
  "call site routes via (connId, db) ... forward `db` so a swapped pool
  still rejects"). 교훈은 contract 의 audit table 이 row-level 로 미리
  못 박혀 있었다는 것 — generator 의 정당화 시도를 contract 가 row
  단위로 reject 할 수 있는 granularity 가 있었기에 catch 가능. audit
  table 을 contract 에 포함시키는 패턴이 evaluator 의 cite-able anchor.
