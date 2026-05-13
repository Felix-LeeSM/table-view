# Sprint 271b Handoff — Query data + dry-run `expected_database` guard

## Status

Complete. Sprint 271 의 두 번째 슬라이스 (2 of 3) — `commands/rdb/query.rs` 의
`query_table_data` + `execute_query_dry_run` 2 command 에 Sprint 266 의
`expected_database` 가드 패턴 전파. probe block 은 271a 의 `ensure_expected_db`
헬퍼로 hoist 하지 않고 **inline 유지** — `query.rs` 는 lock 획득 직전 `register_cancel_token`
으로 cancel handle 을 register 하고 mismatch early-return 경로에서 lock guard
drop 전에 `release_cancel_token` 을 호출해야 하는 ordering 이 schema.rs 패턴과
다름. helper 화 하면 cancel-aware variant 가 필요해 premature abstraction.
mismatch 시 `useQueryExecution` dry-run path 와 `DataGrid` 본체 catch 모두
Sprint 269 의 passive `toast.warning` 으로 Retry 안내 노출 — 두 path 모두
user-initiated (dry-run 버튼 클릭 / table open / refresh / sort / filter / page).

## Audit Table

2 commands marked (b). probe site + cancel-token release 위치 명시.

| # | Command | Probe site (inline) | Cancel-release on mismatch | Frontend wrapper | Caller updated | Test added |
|---|---|---|---|---|---|---|
| 15 | `execute_query_dry_run` | `query.rs:301–310` (inside `active_connections.lock()` L289) | `query.rs:304` — `release_cancel_token(state, &cancel_handle).await` before early return | `query.ts` `executeQueryDryRun` (L103–115) | `useQueryExecution.ts:991–996` dry-run path (forward `workspaceDb ?? undefined`) | `query.rs:993+` — 3 cases (happy / mismatch / cancel-release) |
| 17 | `query_table_data` | `query.rs:442–451` (inside `active_connections.lock()` L430) | `query.rs:445` — `release_cancel_token(state, &cancel_handle).await` before early return | `query.ts` `queryTableData` (L15–37) | `schemaStore.queryTableData` (`schemaStore.ts:396–424` — forward `db` as `expectedDatabase`, no `handleDbMismatch`); `DataGrid.tsx` fetchData catch (L209–258) — single user-initiated surface | `query.rs:1112+` — 3 cases (happy / mismatch / cancel-release) |

## Acceptance Criteria — verification

| AC | 결과 (271b 한정) |
|---|---|
| AC-271-01 audit pinned | ✅ 2 commands (b) — contract row #15, #17. 위 table 이 fixed enumeration |
| AC-271-02 backend handler accepts `expected_database` | ✅ 양 command 모두 `Option<String>` last-positional 수용. probe block 이 Sprint 266 reference (`query.rs:83-92`) 와 byte-equivalent — same lock scope, same `unwrap_or_default()`, same `AppError::DbMismatch { expected, actual }`, trait dispatch 직전 ordering. `None` path byte-equivalent |
| AC-271-03 TS wrapper + JSDoc | ✅ `src/lib/tauri/query.ts` 의 `queryTableData` (L15–37), `executeQueryDryRun` (L103–115) 모두 `expectedDatabase?: string` last-positional 수용, `expected_database: expectedDatabase ?? null` forward. JSDoc Sprint 271b 참조 |
| AC-271-04 callers forward active db | ✅ `useQueryExecution` dry-run path L991–996 (`workspaceDb ?? undefined`); `schemaStore.queryTableData` L396–424 (`db` forwarding, sync helper 미호출 — DataGrid catch 가 단일 surface 소유); `DataGrid.tsx` L209–258 (workspace `(connId, db)` 읽음) |
| AC-271-05 sync helper reuse | ✅ 271a 에서 추출한 `src/lib/api/syncMismatchedActiveDb.ts` 재사용. `useQueryExecution` 은 toast 포함, `DataGrid` 는 toast 포함. `schemaStore.queryTableData` 는 silent — DataGrid 가 user-initiated surface 이므로 store-layer 가 toast 를 중복 발사하지 않도록 helper 호출 자체 생략 |
| AC-271-06 backend mismatch tests | ✅ 2 commands × 3 case (happy / mismatch / cancel-release) = 6 신규 test. mismatch case 의 trait closure 가 `panic!("must not run on mismatch")` — guard regression fail-loud. cancel-release case 는 registry probe (`!tokens.contains_key(...)`) 로 ordering 검증 |
| AC-271-07 frontend integration test | ✅ `DataGrid.dbMismatch.test.tsx` (NEW, 3 cases — mismatch / non-mismatch silent / happy); `useQueryExecution.dry-run.test.ts` +2 case (database override forwarding + mismatch end-to-end). `schemaStore.test.ts` + `QueryTab.toolbar.test.tsx` assertion 업데이트 only |
| AC-271-08 sub-slicing | ✅ slice 2 of 3. 271a 선행 commit 완료. 본 슬라이스 단독 commit, 271c 미착수 |
| AC-271-09 regression gate | ✅ 6 gates green. cargo lib 689→695 (+6), vitest 3238→3243 (+5), tsc / lint / fmt / clippy clean |

## 주요 production 변경

| 카테고리 | 파일 | 변경 |
|---|---|---|
| (a) backend probe | `src-tauri/src/commands/rdb/query.rs` | `execute_query_dry_run_inner` (L301–310) + `query_table_data_inner` (L442–451) inline probe — Sprint 266 reference 와 byte-equivalent + `release_cancel_token` ordering 보존. 6 신규 `#[tokio::test]` (happy / mismatch / cancel-release × 2). `execute_query`, `execute_query_batch`, `cancel_query` 본체 0 diff (Sprint 266 + skip invariant) |
| (b) frontend wrapper | `src/lib/tauri/query.ts` | `queryTableData` + `executeQueryDryRun` 모두 `expectedDatabase?: string` last-positional 추가, `expected_database: expectedDatabase ?? null` forward. JSDoc Sprint 271b 참조 |
| (c) caller forwarding | `src/components/query/QueryTab/useQueryExecution.ts` (L991–996, L1023–1038), `src/stores/schemaStore.ts` (`queryTableData` L396–424), `src/components/rdb/DataGrid.tsx` (fetchData L209–258, catch L236–253) | dry-run path 는 `workspaceDb` forward + parseDbMismatch → sync → `toast.warning`. schemaStore 는 `db` forward 만, sync helper 호출 안 함 (DataGrid 가 단일 surface 소유). DataGrid catch 는 parseDbMismatch → sync → `toast.warning("Re-open the table to refresh.")` + inline alert |
| (d) test 신규 | `src/components/rdb/DataGrid.dbMismatch.test.tsx` **(NEW, 3 cases)** | (1) mismatch — Sprint 266 wire format throw → `verifyActiveDb` + `setActiveDb` + `clearForConnection` + `toast.warning(db2)` + `findByRole("alert")`. (2) non-mismatch — `"Connection refused"` → sync 미호출 / toast 미발사 (silent regression guard). (3) happy — default fixture 정상 렌더 |
| (e) test assertion 업데이트 | `useQueryExecution.dry-run.test.ts` (+2 case + 2 assertion), `schemaStore.test.ts` (3 assertion), `QueryTab.toolbar.test.tsx` (1 assertion) | 신규 positional arg 반영 — rewrite 아님. dry-run.test 에는 (1) `database: "myDb"` override → `expectedDatabase="myDb"` forward 검증, (2) mismatch end-to-end → `failQuery` + `verifyActiveDb` + `toast.warning` 검증 케이스 추가 |

## 테스트

### Backend (cargo lib) — 689 → 695 (+6)

`src-tauri/src/commands/rdb/query.rs::mod tests`:
- 3 × `execute_query_dry_run_*` — happy (`current_database == expected` → trait dispatch), mismatch (stub `Some("X")` vs `Some("Y")` → `Err(DbMismatch)` + trait closure `panic!`), `execute_query_dry_run_mismatch_releases_cancel_token` (`:1021–1036` — registry probe `!tokens.contains_key("qd-mismatch")` 로 release-on-early-return 검증).
- 3 × `query_table_data_*` — 동일 shape. `query_table_data_mismatch_releases_cancel_token` (`:1152–1179`) 은 sprint 의 핵심 — `query_table_data_inner` 가 lock 획득 **이전**에 cancel handle 을 register 하기 때문에 release ordering 이 진짜로 load-bearing.

### Frontend (vitest) — 3238 → 3243 (+5)

- `src/components/rdb/DataGrid.dbMismatch.test.tsx` **(NEW, +3 case)** — mismatch / non-mismatch silent regression / happy 3 case.
- `src/components/query/QueryTab/useQueryExecution.dry-run.test.ts` **(+2 case)** — database override forwarding + mismatch end-to-end. 기존 2 IPC assertion 은 새 positional `"db1"` 반영 업데이트.
- `src/stores/schemaStore.test.ts` — `queryTableData` delegation assertion 3건 positional 업데이트.
- `src/components/query/QueryTab.toolbar.test.tsx` — AC-248-T4 1 assertion 업데이트.

## Out of Scope (this slice)

- **Sprint 271c** — DDL 11 commands. `*Request` struct `#[serde(default)] expected_database: Option<String>` 필드. DDL dialog driver caller forwarding + Retry toast 재사용. 별 commit.
- **`cancel_query`** — db-agnostic skip. `query.rs` 의 본 handler 는 0 diff. byte-equivalent verify.
- **Mongo / document-paradigm commands** — separate adapter trait, 별 sprint.
- **Sprint 271a — schema introspection** — 선행 commit 완료. 본 슬라이스에서 0 diff.

## Lessons

- **Helper hoisting trade-off — query.rs 는 inline 유지** — 271a 의
  `ensure_expected_db(adapter, expected_database)` 헬퍼는 cancel-token unaware.
  `schema.rs` 는 mismatch 시 lock guard drop 만 하면 됐지만 `query.rs` 는
  `register_cancel_token` 으로 등록한 handle 을 `release_cancel_token` 으로
  먼저 풀어줘야 하는 ordering 이 critical — helper 화 하면 cancel-aware variant
  가 필요하고, 두 trait 가 보호하는 invariant 가 달라 single helper 로 합치면
  signature 가 leaky. premature abstraction 회피 → 2 site inline 으로 유지.
  Helper extraction 의 timing 은 "원본 stable + 추가 site ≥3 + invariant 동일"
  세 조건 모두 만족할 때.
- **모든 DataGrid fetch 가 user-initiated** — sidebar prefetch 류는
  schemaStore 를 통과하므로 271a 의 silent path (toast 미발사) 가 담당. 반면
  DataGrid 본체의 fetch entry 는 mount / explicit refresh / sort header click /
  filter apply / page change 모두 user UI interaction 의 downstream — 모두
  Retry toast 노출 대상. catch 한 곳에서 일관되게 `toast.warning` 발사가 옳음.
  `schemaStore.queryTableData` 가 sync helper 를 호출하지 않는 이유도 동일
  surface 의 중복 toast 방지.
- **Dry-run Retry 는 passive 로 충분** — `runRdbSingleNow` /
  `runRdbBatchNow` 는 lexical statement capture 가 필요해 ref-backed retry
  helper 가 있지만, dry-run 은 toolbar 의 single button 클릭으로 재실행
  가능하므로 별도 capture 불요. Sprint 269 의 Retry button 없는 passive
  `toast.warning("Re-run the dry-run if needed.")` 만으로 user action 명확 —
  premature ref-backed surface 회피.
