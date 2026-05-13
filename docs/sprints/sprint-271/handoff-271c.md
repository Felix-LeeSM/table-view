# Sprint 271c Handoff — DDL `expected_database` guard (11 commands)

## Status

Complete. Sprint 271 의 세 번째 슬라이스 (3 of 3) — `commands/rdb/ddl.rs` 의
11 DDL command (`drop_table` / `rename_table` / `alter_table` / `add_column` /
`drop_column` / `create_table` / `create_table_plan` / `create_index` /
`drop_index` / `add_constraint` / `drop_constraint`) 에 Sprint 266 의
`expected_database` 가드 패턴 전파. 각 Request struct 에
`#[serde(default)] expected_database: Option<String>` 필드를 추가 — `serde`
기본값으로 기존 caller payload 가 deserialize 되어도 `None` 으로 채워지므로
wire-compatible. 271a 가 `schema.rs` 에 둔 `ensure_expected_db` 헬퍼를
`src-tauri/src/commands/rdb/mod.rs` 로 hoist — schema 12 + DDL 11 = **23 sites**
가 공유. `query.rs` 는 cancel-token release ordering 때문에 inline 유지
(271b 결정 보존). DDL surface 의 mismatch 처리는 `useDdlPreviewExecution` 의
`loadPreview` / `runCommit` 양쪽 catch 에서 passive `toast.warning` — DDL
dialog 가 열린 채 `previewError` 가 노출되고 user 가 동일 Apply 버튼을 재클릭
하므로 ref-backed retry closure 불필요.

## Audit Table

11 commands marked (b). probe site, Request struct (snake/camel mix per consumer
style), 테스트, 프론트 wrapper, dialog/editor caller 표기.

| # | Command | Probe site (`ddl.rs`) | Request struct | Frontend wrapper | Caller updated | Test added |
|---|---|---|---|---|---|---|
| 18 | `drop_table` | `:41` | `DropTableRequest` | `ddl.ts` `dropTable` | `schemaStore.dropTable` (`schemaStore.ts:427`), `DropTableDialog` | `ddl.rs:767` |
| 19 | `rename_table` | `:67` | `RenameTableRequest` | `ddl.ts` `renameTable` | `schemaStore.renameTable` (`schemaStore.ts:442`), `RenameTableDialog` | `ddl.rs` mismatch + happy |
| 20 | `alter_table` | `:90` | `AlterTableRequest` | `ddl.ts` `alterTable` | `StructurePanel` + `ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor` | `ddl.rs` mismatch |
| 21 | `add_column` | `:111` | `AddColumnRequest` | `ddl.ts` `addColumn` | `AddColumnDialog`, `ColumnsEditor` | `ddl.rs` mismatch |
| 22 | `drop_column` | `:135` | `DropColumnRequest` | `ddl.ts` `dropColumn` | `DropColumnDialog`, `ColumnsEditor` | `ddl.rs` mismatch |
| 23 | `create_table` | `:158` | `CreateTableRequest` | `ddl.ts` `createTable` | `CreateTableDialog` | `ddl.rs` mismatch |
| 24 | `create_table_plan` | `:179` | `CreateTablePlanRequest` | `ddl.ts` `createTablePlan` | `CreateTableDialog` (plan path) | `ddl.rs` mismatch (triple-child panic guard via `traits.rs:267,285,306`) |
| 25 | `create_index` | `:203` | `CreateIndexRequest` | `ddl.ts` `createIndex` | `IndexesEditor` | `ddl.rs` mismatch |
| 26 | `drop_index` | `:224` | `DropIndexRequest` | `ddl.ts` `dropIndex` | `IndexesEditor` | `ddl.rs` mismatch |
| 27 | `add_constraint` | `:245` | `AddConstraintRequest` | `ddl.ts` `addConstraint` | `ConstraintsEditor` | `ddl.rs` mismatch |
| 28 | `drop_constraint` | `:266` | `DropConstraintRequest` | `ddl.ts` `dropConstraint` | `ConstraintsEditor` | `ddl.rs` mismatch |

모든 `_inner` fn 이 `as_rdb()?` 직후, trait dispatch 직전 위치에서
`ensure_expected_db(adapter, request.expected_database.as_deref()).await?` 호출.
`create_table_plan` 의 default trait impl (`db/traits.rs:264-315`) 는 chained
children Request (`parent_req`, `ireq`, `creq`) 에 `expected_database: None`
을 set — parent probe 가 single source of truth, 자식은 재-probe 안 함.

## Acceptance Criteria — verification

| AC | 결과 (271c 한정) |
|---|---|
| AC-271-01 audit pinned | ✅ 11 commands (b). 위 table 이 fixed enumeration. 271a (12) + 271b (2) + 271c (11) = 25 total (b) |
| AC-271-02 backend handler accepts `expected_database` | ✅ 11 `_inner` fn 각각 `ensure_expected_db` 호출 (line 41/67/90/111/135/158/179/203/224/245/266). `None` 경로는 byte-equivalent — `Some` 분기 short-circuit 으로 `current_database` 자체를 probe 안 함 |
| AC-271-03 TS wrapper + JSDoc | ✅ `src/lib/tauri/ddl.ts` 11 wrapper 모두 `request.expectedDatabase?: string` (struct-shape) 또는 compat positional. Sprint 271c JSDoc 부착 |
| AC-271-04 callers forward active db | ✅ `schemaStore.dropTable` / `renameTable` 가 workspace `db` forward. DDL dialog (DropTable/RenameTable/AddColumn/DropColumn/CreateTable/StructurePanel) + editor (Columns/Indexes/Constraints) 모두 workspace `(connId, db)` thread |
| AC-271-05 sync helper reuse | ✅ `useDdlPreviewExecution.ts:127-139, 165-182, 204-211` 의 `runCommit` + `loadPreview` catch 가 `parseDbMismatch` → `syncMismatchedActiveDb` → passive `toast.warning`. DDL 은 user-initiated → Sprint 269 passive Retry 면 충분 (dialog Apply 버튼이 자연 retry surface) |
| AC-271-06 backend mismatch tests | ✅ 11 × `*_expected_db_mismatch_returns_dbmismatch_and_skips_trait` + `create_table_plan` 3-child panic 가드. mismatch case 의 trait closure 가 `panic!("must not run on mismatch")` — guard regression fail-loud |
| AC-271-07 frontend integration test | ✅ `DropTableDialog.dbMismatch.test.tsx` + `CreateTableDialog.dbMismatch.test.tsx` 각 2 case = 4 total. mismatch path 가 `verifyActiveDb("conn-1")` + `setActiveDb` + `toast.warning("db-2")` 발사 검증. non-mismatch silent-regression guard 가 sync / toast 모두 호출 안 됨 검증 |
| AC-271-08 sub-slicing | ✅ slice 3 of 3. 271a (`13c11ed`) + 271b (`0369b30`) 선행. 본 슬라이스 단독 commit |
| AC-271-09 regression gate | ✅ 6 gates green. cargo lib 695→708 (+13), vitest 3243→3247 (+4), tsc / lint / fmt / clippy clean |

## 주요 production 변경

| 카테고리 | 파일 | 변경 |
|---|---|---|
| (a) backend helper hoist | `src-tauri/src/commands/rdb/mod.rs` | `ensure_expected_db(adapter, expected_database: Option<&str>)` helper 가 `:50-64` 에 정주. 271a 의 `schema.rs:33-47` 본문 verbatim — schema 12 + DDL 11 = **23 sites** 공유. `query.rs` 는 import 안 함 (cancel-token ordering, inline 유지) |
| (b) backend probe | `src-tauri/src/commands/rdb/ddl.rs` | 11 `_inner` fn 각각 `ensure_expected_db(adapter, request.expected_database.as_deref()).await?` 호출 (line 41/67/90/111/135/158/179/203/224/245/266). 13 신규 `#[tokio::test]` — 11 mismatch + 1 match-happy + 1 None fast-path |
| (c) Request struct | `src-tauri/src/models/schema.rs` | 11 Request struct 에 `#[serde(default)] pub expected_database: Option<String>` 필드. wire-compat — 기존 caller payload 가 field 누락해도 `None` 으로 deserialize |
| (d) struct-literal callsites | 85 internal sites | Request struct 신규 필드 명시 `expected_database: None` 채움 (compile error 회피). 대부분 test fixture / default plan-child |
| (e) traits.rs default impl | `src-tauri/src/db/traits.rs:267,285,306` | `create_table_plan` default impl 이 chained `parent_req` / `ireq` / `creq` 에 `expected_database: None` set — parent probe authoritative, child 재-probe 회피 |
| (f) frontend wrapper | `src/lib/tauri/ddl.ts` | 11 wrapper 모두 `request.expectedDatabase?: string` 또는 compat positional. `expected_database: ... ?? null` forward. JSDoc Sprint 271c |
| (g) types | `src/types/schema.ts` | 11 Request interface 에 expectedDatabase 필드 (snake/camel mix per consumer style — 후속 cleanup 후보) |
| (h) caller forwarding | `src/stores/schemaStore.ts` (dropTable/renameTable 2 action), `src/components/structure/useDdlPreviewExecution.ts` (preview + commit catch), DDL dialog/editor 8 site | 모두 workspace `(connId, db)` forward. preview/commit catch 가 `parseDbMismatch` → `syncMismatchedActiveDb` → `toast.warning` |

## 테스트

### Backend (cargo lib) — 695 → 708 (+13)

`src-tauri/src/commands/rdb/ddl.rs::mod tests`:
- 11 × `*_expected_db_mismatch_returns_dbmismatch_and_skips_trait` — stub
  `current_database = Some("dbA")`, request `expected_database = Some("dbB")`
  → `Err(AppError::DbMismatch { expected: "dbB", actual: "dbA" })`. trait
  closure 가 `panic!("must not run on mismatch")` — guard regression fail-loud.
- 1 × `drop_table_expected_db_match_executes_normally` — happy path
  (`current_database == expected` → trait dispatch 정상).
- 1 × `drop_table_expected_db_none_skips_current_database_probe` —
  `current_database_fn = panic!` 로 stub. request `expected_database = None`
  → probe 자체가 skip 됨을 증명 (byte-equivalence).
- `create_table_plan_expected_db_mismatch_returns_dbmismatch_and_skips_trait`
  는 chained 3 children (`create_table_fn`, `create_index_fn`,
  `add_constraint_fn`) 모두 panic-stub — probe 가 child 호출 이전에 halt 함을
  증명.

### Frontend (vitest) — 3243 → 3247 (+4)

- `src/components/schema/DropTableDialog.dbMismatch.test.tsx` **(NEW, +2 case)** —
  mismatch end-to-end (`verifyActiveDbMock("conn-1")` + `setActiveDb` +
  `toast.warning("db-2")` assertion) + non-mismatch silent (sync / toast 미호출).
- `src/components/schema/CreateTableDialog.dbMismatch.test.tsx` **(NEW, +2 case)** —
  동일 shape.

### 어셉션 업데이트 (rewrite 아님)

- `src/hooks/useDdlPreviewExecution.test.ts` 등 기존 spec — 신규 positional /
  field arg 반영 update.
- `src/types/schema.ts` mixed-case 필드는 271+1 cleanup 으로 deferred
  (Evaluator non-blocking observation).

## Out of Scope (this slice)

- **Mongo / document-paradigm commands** — separate adapter trait, 별 sprint.
- **`cancel_query`** — db-agnostic skip (Sprint 271 contract row #16).
- **Sprint 266 already-guarded commands** — `execute_query`,
  `execute_query_batch` byte-equivalent. `git diff 0369b30 -- query.rs` = 0 lines.
- **Sprint 271a / 271b sites** — probe behavior 보존, helper body 만 hoist.
  `schema.rs` 의 12 call site 는 import path 만 갱신.
- **Retry button on DDL toast** — dialog 의 Apply 버튼이 자연 retry surface
  이므로 passive `toast.warning` 충분. ref-backed retry helper 도입 안 함.

## Lessons

- **Helper hoisting timing — 12 시점은 borderline, 23 시점이 trigger** — 271a
  의 12 sites 만으로는 `schema.rs` local helper 가 충분히 정당화 됐지만 (모듈
  내 응집), 271c 의 11 sites 가 합류하면서 `mod.rs` 로 올려 schema+DDL 23
  sites 공유. helper 추출은 "원본 stable + 추가 site ≥3 + invariant 동일"
  조건 만족 후가 적시. `query.rs` 는 cancel-token release ordering 으로
  invariant 가 달라 hoist 대상 아님 — premature abstraction 회피.
- **`#[serde(default)]` 가 wire compat 보장** — Request struct 에 신규 필드
  추가 시 `#[serde(default)]` 가 기존 caller payload 가 field 누락한 채
  deserialize 됐을 때 `None` 으로 채워줌 → 기존 wire 호환. 다만 Rust
  struct-literal callsite 85곳은 compile error 회피 위해 명시 `expected_database:
  None` 추가 필요 — wire-compat 과 struct-literal-compat 은 다른 문제.
- **Passive toast 가 충분 — dialog Apply 가 자연 retry surface** — DDL 은
  dialog 가 열린 채 `previewError` 가 노출되고 user 가 동일 Apply 버튼을
  재클릭하면 됨. Sprint 269 의 ref-backed retry closure 는 (a) tab 안에 머무는
  query path, (b) lexical statement capture 가 필요한 batch 에서만 가치 있음.
  DDL 처럼 dialog state 가 그대로 retry context 인 경우는 passive `toast.warning`
  + dialog re-confirm 으로 충분.
